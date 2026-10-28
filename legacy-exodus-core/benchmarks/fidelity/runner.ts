import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { DiscoveryArtifactProvenance, FidelityValidationReport, GroundTruthFact } from "@contracts/fidelity";
import { MigrationFidelityValidator, type PredictionPayload } from "@governance/fidelity/fidelity-validator";
import { resolveBenchmarkRepoPath, resolveFidelityResultsDir } from "../paths";
import { ensureCacheEntryVerified } from "../scripts/acquire";
import { fastifyGroundTruth } from "./fastify-ground-truth";
import { expressGroundTruth } from "./express-ground-truth";

export interface RunFidelityOptions {
  readonly repoPath: string;
  readonly targetName?: string;
  readonly groundTruth?: readonly GroundTruthFact[];
  readonly closedScopeFilePaths?: readonly string[];
  readonly predictions?: PredictionPayload;
  readonly provenance?: DiscoveryArtifactProvenance;
  readonly outputDir?: string;
  readonly expectedRepositoryName?: string;
  readonly expectedRepositoryRevision?: string;
  readonly expectedEngineCommitSha?: string;
  readonly expectedAnalysisRunId?: string;
  /** Directory holding the acquired corpora. Defaults to benchmarks/.cache. */
  readonly cacheDir?: string;
}

export async function runFidelityValidation(options: RunFidelityOptions): Promise<FidelityValidationReport> {
  const absRepoPath = resolveBenchmarkRepoPath(options.repoPath);
  // Ground truth describes the pinned corpus: a repository inside the benchmark cache is verified against
  // its manifest before anything is read from it (BA-20 / A6). Other repositories are the caller's own.
  await ensureCacheEntryVerified(absRepoPath, options.cacheDir);
  const isExpress = absRepoPath.toLowerCase().includes("express");
  const discoveryDir = join(absRepoPath, ".discovery");

  let predictions: PredictionPayload;
  let provenance: DiscoveryArtifactProvenance | undefined = options.provenance;
  let freshnessStatus: "FRESH" | "STALE" | "MISMATCHED" | "CORRUPTED" | "MISSING_PROVENANCE" = "FRESH";

  if (options.predictions) {
    predictions = options.predictions;
    freshnessStatus = "FRESH";
  } else {
    const manifestPath = join(discoveryDir, "manifest.json");

    if (!existsSync(manifestPath)) {
      throw new Error(
        `Missing required discovery manifest: ${manifestPath}. ` +
          `Discovery provenance, freshness, and artifact integrity cannot be established.`,
      );
    }

    let manifestRaw: string;
    try {
      manifestRaw = await readFile(manifestPath, "utf8");
    } catch (err: any) {
      throw new Error(`Failed to read discovery manifest at ${manifestPath}: ${err.message}`);
    }

    try {
      provenance = JSON.parse(manifestRaw) as DiscoveryArtifactProvenance;
    } catch (err: any) {
      throw new Error(`Malformed discovery manifest at ${manifestPath}: Invalid JSON structure.`);
    }

    if (!provenance || !provenance.repository || !provenance.engine || !provenance.analysis || !provenance.artifacts) {
      throw new Error(`Malformed discovery manifest at ${manifestPath}: Missing required provenance sections.`);
    }

    // Verify and Normalize Engine Identity
    const rawProvSha = provenance.engine.commitSha;
    const provEngineSha =
      typeof rawProvSha === "string" && rawProvSha.trim().length > 0
        ? rawProvSha.trim()
        : undefined;

    if (!provEngineSha) {
      throw new Error(
        `Malformed discovery manifest at ${manifestPath}: Missing or invalid engine.commitSha in provenance.`,
      );
    }

    // Ensure normalized provenance is stored for downstream reporting
    provenance = {
      ...provenance,
      engine: {
        ...provenance.engine,
        commitSha: provEngineSha,
      },
    };

    // Verify Repository Identity
    const expectedRepo = options.expectedRepositoryName ?? (isExpress ? "express" : "fastify");
    const actualRepoName = provenance.repository.name;
    const actualRepoPath = provenance.repository.path;
    if (
      actualRepoName.toLowerCase() !== expectedRepo.toLowerCase() &&
      !actualRepoPath.toLowerCase().includes(expectedRepo.toLowerCase())
    ) {
      throw new Error(
        `Repository identity mismatch: expected '${expectedRepo}', found '${actualRepoName}' (${actualRepoPath}).`,
      );
    }

    // Verify Repository Revision (if requested)
    if (options.expectedRepositoryRevision) {
      const actualRevision = provenance.repository.packageVersion ?? provenance.repository.commitSha;
      if (actualRevision !== options.expectedRepositoryRevision) {
        throw new Error(
          `Repository revision mismatch: expected '${options.expectedRepositoryRevision}', found '${actualRevision}'.`,
        );
      }
    }

    // Verify Engine Identity & Evaluate Dynamic Freshness
    if (options.expectedEngineCommitSha) {
      const expectedSha = options.expectedEngineCommitSha.trim();
      if (provEngineSha !== expectedSha) {
        throw new Error(
          `Engine identity mismatch: expected '${options.expectedEngineCommitSha}', found '${provenance.engine.commitSha}'.`,
        );
      }
      freshnessStatus = "FRESH";
    } else {
      let currentEngineCommitSha: string | undefined;
      try {
        const resolvedSha = execSync("git rev-parse HEAD", {
          cwd: resolve(import.meta.dir, "../.."),
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        if (resolvedSha.length > 0) {
          currentEngineCommitSha = resolvedSha;
        }
      } catch {}

      if (currentEngineCommitSha && provEngineSha !== currentEngineCommitSha) {
        freshnessStatus = "STALE";
      } else {
        freshnessStatus = "FRESH";
      }
    }

    // Verify Analysis Run ID (if requested)
    if (options.expectedAnalysisRunId) {
      if (provenance.analysis.analysisRunId !== options.expectedAnalysisRunId) {
        throw new Error(
          `Analysis run identity mismatch: expected '${options.expectedAnalysisRunId}', found '${provenance.analysis.analysisRunId}'.`,
        );
      }
    }

    // Verify Artifact Completeness and SHA-256 Hashes
    const requiredArtifacts = provenance.requiredArtifacts ?? [
      "files.json",
      "dependencies.json",
      "symbols.json",
      "dependency-graph.json",
      "semantic.json",
      "control-flow.json",
      "data-flow.json",
    ];

    for (const artifactName of requiredArtifacts) {
      const artifactEntry = provenance.artifacts[artifactName];
      if (!artifactEntry || !artifactEntry.sha256) {
        throw new Error(`Incomplete discovery manifest: missing hash entry for required artifact '${artifactName}'.`);
      }

      const artifactPath = join(discoveryDir, artifactName);
      if (!existsSync(artifactPath)) {
        throw new Error(
          `Missing required discovery artifact: ${artifactPath}. Required artifact listed in manifest is absent from disk.`,
        );
      }

      const fileBytes = await readFile(artifactPath);
      const actualSha = createHash("sha256").update(fileBytes).digest("hex");
      if (actualSha !== artifactEntry.sha256) {
        throw new Error(
          `Artifact integrity failure: SHA-256 hash mismatch for '${artifactName}'. Expected ${artifactEntry.sha256}, calculated ${actualSha}.`,
        );
      }
    }

    // Read verified discovery projection artifacts
    const filesJson = await readRequiredJson<any[]>(join(discoveryDir, "files.json"));
    const dependenciesJson = await readRequiredJson<any[]>(join(discoveryDir, "dependencies.json"));
    const symbolsJson = await readRequiredJson<any[]>(join(discoveryDir, "symbols.json"));
    const depGraphJson = await readRequiredJson<any>(join(discoveryDir, "dependency-graph.json"));
    const semanticJson = await readRequiredJson<any>(join(discoveryDir, "semantic.json"));
    const controlFlowJson = await readRequiredJson<any>(join(discoveryDir, "control-flow.json"));
    const dataFlowJson = await readRequiredJson<any>(join(discoveryDir, "data-flow.json"));

    const frameworksJson = await readOptionalJson<any[]>(join(discoveryDir, "frameworks.json"), []);

    const dependencyEdges = (depGraphJson?.edges as any[]) ?? [];
    const calls = (semanticJson?.calls as any[]) ?? [];
    const cfgs = (controlFlowJson?.graphs as any[]) ?? (Array.isArray(controlFlowJson) ? controlFlowJson : []);
    const dfgs = (dataFlowJson?.graphs as any[]) ?? (Array.isArray(dataFlowJson) ? dataFlowJson : []);
    const imports = symbolsJson.filter((s: any) => s.kind === "import");
    const exports = symbolsJson.filter((s: any) => s.kind === "export");

    predictions = {
      files: filesJson,
      dependencies: dependenciesJson,
      frameworks: frameworksJson,
      symbols: symbolsJson,
      imports,
      exports,
      dependencyEdges,
      calls,
      cfgs,
      dfgs,
    };
  }

  const groundTruth = options.groundTruth ?? (isExpress ? expressGroundTruth : fastifyGroundTruth);
  const validator = new MigrationFidelityValidator();

  const targetName = options.targetName ?? (isExpress ? "express" : "fastify");
  const closedScopeFilePaths =
    options.closedScopeFilePaths ??
    (isExpress
      ? [
          "package.json",
          "index.js",
          "lib/express.js",
          "lib/application.js",
          "lib/router/index.js",
          "lib/router/route.js",
          "lib/router/layer.js",
          "lib/request.js",
          "lib/response.js",
          "lib/view.js",
          "lib/middleware/init.js",
          "lib/middleware/query.js",
          "lib/utils.js",
          "examples/hello-world/index.js",
          "examples/params/index.js",
          "examples/content-negotiation/index.js",
          "examples/auth/index.js",
          "examples/error/index.js",
          "examples/multi-router/index.js",
          "examples/route-middleware/index.js",
          "test/app.listen.js",
          "test/Route.js",
          "test/app.router.js",
          "test/Router.js",
          "test/res.send.js",
        ]
      : [
          "fastify.js",
          "lib/symbols.js",
          "lib/reply.js",
          "lib/request.js",
          "lib/decorate.js",
          "lib/pluginOverride.js",
          "lib/route.js",
          "lib/hooks.js",
          "lib/context.js",
          "lib/errors.js",
          "lib/schema-controller.js",
          "lib/logger-pino.js",
          "lib/contentTypeParser.js",
          "lib/pluginUtils.js",
          "test/404s.test.js",
          "lib/handleRequest.js",
          "lib/server.js",
          "lib/fourOhFour.js",
          "lib/validation.js",
          "lib/schemas.js",
          "lib/error-handler.js",
          "lib/warnings.js",
          "lib/wrapThenable.js",
          "lib/reqIdGenFactory.js",
          "lib/configValidator.js",
        ]);

  const report = validator.validate(groundTruth, predictions, {
    targetName,
    isSampleBased: true,
    samplingMethodology: isExpress
      ? "Deterministic stratified representative sample covering 25 architectural files across entrypoints, application prototypes, router/layer/route dispatch stacks, request/response lifecycles, view systems, middleware, utilities, application examples, and test integration suites, validated across 10 semantic categories with known-negative failure-first checks."
      : "Deterministic stratified representative sample covering 25 architectural files across entrypoints, core lifecycles, decorators, plugin inheritance, error catalogs, routing, schema controllers, logger, content type parsers, request dispatchers, server listeners, schemas, validation, error handlers, warnings, promise wrappers, and tests, validated across 10 semantic categories with known-negative failure-first checks.",
    closedScopeFilePaths: [...closedScopeFilePaths],
    limitations: isExpress
      ? [
          "Representative ground-truth sample (150+ facts) provides deep multi-category evidence across 25 files, but does NOT establish whole-repository migration safety.",
          "Predictions outside the 25 validated files belong to the UNVALIDATED universe and are NOT counted as false positives.",
          "Dynamic template engine loading and prototypal method patching are validated via static structural contracts only.",
        ]
      : [
          "Representative ground-truth sample (150+ facts) provides deep multi-category evidence across 25 files, but does NOT establish whole-repository migration safety.",
          "Predictions outside the 25 validated files belong to the UNVALIDATED universe and are NOT counted as false positives.",
          "Dynamic plugin registration and runtime decoration are validated via static structural contracts only.",
        ],
  });

  const enrichedReport: FidelityValidationReport = {
    ...report,
    ...(provenance ? { provenanceEvidence: provenance } : {}),
    freshnessStatus,
  };

  // Print human-readable report
  printFidelityReport(enrichedReport);

  // Write artifact
  const outDir = resolveFidelityResultsDir(options.outputDir);
  await mkdir(outDir, { recursive: true });
  await writeFile(
    join(outDir, "fidelity-report.json"),
    JSON.stringify(enrichedReport, null, 2),
    "utf8",
  );

  return enrichedReport;
}

function printFidelityReport(report: FidelityValidationReport): void {
  console.log(`\n╔══════════════════════════════════════════════════════════╗`);
  console.log(`║  LegacyExodus — Migration Fidelity Validation Report     ║`);
  console.log(`╚══════════════════════════════════════════════════════════╝\n`);

  console.log(`Target:             ${report.targetName}`);
  if (report.provenanceEvidence) {
    console.log(`Repository:         ${report.provenanceEvidence.repository.name} (${report.provenanceEvidence.repository.packageVersion ?? report.provenanceEvidence.repository.commitSha?.slice(0, 10) ?? "N/A"})`);
    console.log(`Engine SHA:         ${report.provenanceEvidence.engine.commitSha.slice(0, 10)} (${report.provenanceEvidence.engine.packageVersion})`);
    console.log(`Freshness:          ${report.freshnessStatus ?? "FRESH"}`);
  }
  console.log(`Evaluation Mode:    ${report.isSampleBased ? "SAMPLE-BASED VALIDATION" : "WHOLE-REPOSITORY VALIDATION"}`);
  console.log(`Ground Truth Facts: ${report.totalGroundTruthFacts}`);
  console.log(`Total Preds:        ${report.totalPredictedFacts} (${report.totalValidatedScopePredictions} in validated scope [${report.overallTruePositives} TP, ${report.totalUnverifiedScopedPredictions} unverified, ${report.overallFalsePositives} FP], ${report.totalUnvalidatedPredictions} unvalidated)`);
  console.log(`True Positives:     ${report.overallTruePositives}`);
  console.log(`False Positives:    ${report.overallFalsePositives} (disproven / closed-world violations)`);
  console.log(`False Negatives:    ${report.overallFalseNegatives}`);
  console.log(`Sample Precision:   ${report.overallPrecision !== null ? (report.overallPrecision * 100).toFixed(1) + "%" : "N/A (Sample-Based)"}`);
  console.log(`Sample Recall:      ${report.overallRecall !== null ? (report.overallRecall * 100).toFixed(1) + "%" : "N/A"}`);
  console.log(`Actionable Correct: ${report.overallActionableCorrectness !== null ? (report.overallActionableCorrectness * 100).toFixed(1) + "%" : "N/A"}`);
  console.log(`Actionable Verdict: ${report.actionableVerdict}`);
  console.log(`Migration Safety:   ${report.migrationSafetyVerdict}\n`);

  console.log(`Category Breakdown:`);
  console.log(`-------------------------------------------------------------------------------------------------------------------------`);
  console.log(`Category          | Scope        | GT Count | Scoped | Unverified | Unvalidated |   TP |   FP |   FN | Precision | Recall `);
  console.log(`-------------------------------------------------------------------------------------------------------------------------`);
  for (const c of report.categories) {
    if (c.groundTruthCount === 0 && c.totalPredictedCount === 0) continue;
    const precStr = c.precision !== null ? `${(c.precision * 100).toFixed(1)}%` : "N/A";
    const recStr = c.recall !== null ? `${(c.recall * 100).toFixed(1)}%` : "N/A";
    const scopeStr = c.worldScope === "CLOSED_WORLD" ? "CLOSED" : "SAMPLE";
    console.log(
      `${c.category.padEnd(17)} | ` +
      `${scopeStr.padEnd(12)} | ` +
      `${c.groundTruthCount.toString().padStart(8)} | ` +
      `${c.scopedPredictedCount.toString().padStart(6)} | ` +
      `${c.unverifiedScopedCount.toString().padStart(10)} | ` +
      `${c.unvalidatedPredictedCount.toString().padStart(11)} | ` +
      `${c.truePositives.toString().padStart(4)} | ` +
      `${c.falsePositives.toString().padStart(4)} | ` +
      `${c.falseNegatives.toString().padStart(4)} | ` +
      `${precStr.padStart(9)} | ` +
      `${recStr.padStart(6)}`
    );
  }
  console.log(`-------------------------------------------------------------------------------------------------------------------------\n`);

  console.log(`Limitations:`);
  for (const lim of report.limitations) {
    console.log(`  - ${lim}`);
  }
  console.log("");
}

async function readRequiredJson<T>(path: string): Promise<T> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      throw new Error(`Missing required discovery artifact: ${path}. Discovery projections must be generated before running fidelity validation.`);
    }
    throw err;
  }
}

async function readOptionalJson<T>(path: string, defaultValue: T): Promise<T> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return defaultValue;
    }
    throw err;
  }
}
