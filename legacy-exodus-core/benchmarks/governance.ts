/**
 * Phase 3A — Benchmark Governance & Quality Gates
 *
 * Implements:
 * - Mathematical File Accounting Invariant Check
 * - Analysis Completeness Verification
 * - Benchmark Contamination Guard
 * - Deterministic Health Score Aggregator
 * - Engine and Repository Identity Resolvers
 */

import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { arch, platform, version as bunVersion } from "node:process";

import type {
  AnalysisCompleteness,
  AnalysisDisposition,
  BenchmarkHealthScore,
  BenchmarkManifest,
  CompletenessStatus,
  ContaminationGuardReport,
  EngineIdentity,
  FileAccounting,
  GateStatus,
  PerformanceStatus,
  RepositoryIdentity,
} from "./types";

// ─── 1. Mathematical File Accounting Gate ─────────────────────────────────────────

export function computeFileAccounting(disposition: AnalysisDisposition): FileAccounting {
  const breakdown = {
    analyzed: disposition.filesAnalyzed,
    parserFailures: disposition.parserFailures,
    symbolExtractionFailures: disposition.symbolExtractionFailures,
    unsupportedFiles: disposition.unsupportedFiles,
    nonSourceArtifacts: disposition.nonSourceArtifacts,
    unclassifiedArtifacts: disposition.unclassifiedArtifacts,
  };

  const computedTotal =
    breakdown.analyzed +
    breakdown.parserFailures +
    breakdown.symbolExtractionFailures +
    breakdown.unsupportedFiles +
    breakdown.nonSourceArtifacts +
    breakdown.unclassifiedArtifacts;

  const reconciles = disposition.filesDiscovered === computedTotal;
  const discrepancy = disposition.filesDiscovered - computedTotal;

  return {
    filesDiscovered: disposition.filesDiscovered,
    computedTotal,
    reconciles,
    discrepancy,
    breakdown,
  };
}

// ─── 2. Analysis Completeness Gate ────────────────────────────────────────────────

export function verifyCompleteness(
  disposition: AnalysisDisposition,
  accounting: FileAccounting,
  contamination: ContaminationGuardReport,
): AnalysisCompleteness {
  const unanalyzedSourceFiles: string[] = [];
  const unassignedFailures: string[] = [];
  const duplicateDispositions: string[] = [];
  const details: string[] = [];

  if (!accounting.reconciles) {
    details.push(`File accounting mismatch: discovered ${accounting.filesDiscovered} vs computed ${accounting.computedTotal} (delta: ${accounting.discrepancy})`);
  }

  if (contamination.isContaminated) {
    details.push(`Contamination detected in analyzed paths: ${contamination.benchmarkArtifactsExcluded.join(", ")}`);
  }

  if (disposition.parserFailures > 0) {
    details.push(`${disposition.parserFailures} parser failure(s) recorded`);
  }

  if (disposition.symbolExtractionFailures > 0) {
    details.push(`${disposition.symbolExtractionFailures} symbol extraction failure(s) recorded`);
  }

  let status: CompletenessStatus = "PASS";
  if (!accounting.reconciles || contamination.isContaminated) {
    status = "FAIL";
  } else if (disposition.unclassifiedArtifacts > 0 || disposition.parserFailures > 0 || disposition.symbolExtractionFailures > 0) {
    status = "NEEDS_REVIEW";
  }

  return {
    status,
    unanalyzedSourceFiles,
    unassignedFailures,
    duplicateDispositions,
    benchmarkCacheContaminationDetected: contamination.isContaminated,
    details,
  };
}

// ─── 3. Contamination Guard ───────────────────────────────────────────────────────

export function detectContamination(repoPath: string, discoveredFiles: readonly { path: string }[]): ContaminationGuardReport {
  const ignoredDirectories = [".git", "node_modules", ".cache", ".discovery", "dist", "build", ".legacy-exodus"];
  const ignoredFiles: string[] = [];
  const generatedArtifactsExcluded: string[] = [];
  const benchmarkArtifactsExcluded: string[] = [];

  let isContaminated = false;

  for (const f of discoveredFiles) {
    const p = f.path.replace(/\\/g, "/");
    if (p.includes(".cache/") || p.includes("benchmarks/.cache")) {
      benchmarkArtifactsExcluded.push(p);
      isContaminated = true;
    }
    if (p.includes(".discovery/") || p.includes(".legacy-exodus/")) {
      generatedArtifactsExcluded.push(p);
      isContaminated = true;
    }
    if (p.includes("node_modules/") || p.includes(".git/")) {
      ignoredFiles.push(p);
      isContaminated = true;
    }
  }

  return {
    isContaminated,
    ignoredDirectories,
    ignoredFiles,
    generatedArtifactsExcluded,
    benchmarkArtifactsExcluded,
  };
}

// ─── 4. Benchmark Health Score Aggregator ──────────────────────────────────────────

export function computeHealthScore(
  accounting: FileAccounting,
  completeness: AnalysisCompleteness,
  determinismPassed: boolean,
  performanceStatus: PerformanceStatus = "STABLE",
  qualitySamplePassed = true,
): BenchmarkHealthScore {
  const correctness: GateStatus = accounting.reconciles && completeness.status !== "FAIL" ? "PASS" : "FAIL";
  const compStatus: GateStatus = completeness.status === "PASS" ? "PASS" : completeness.status === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : "FAIL";
  const detStatus: GateStatus = determinismPassed ? "PASS" : "FAIL";
  const qsStatus: GateStatus = qualitySamplePassed ? "PASS" : "NEEDS_REVIEW";

  let overall: GateStatus = "PASS";
  if (correctness === "FAIL" || compStatus === "FAIL" || detStatus === "FAIL") {
    overall = "FAIL";
  } else if (compStatus === "NEEDS_REVIEW" || qsStatus === "NEEDS_REVIEW" || performanceStatus === "REGRESSED") {
    overall = "NEEDS_REVIEW";
  }

  const summary = `Correctness: ${correctness} | Completeness: ${compStatus} | Determinism: ${detStatus} | Performance: ${performanceStatus} | Quality: ${qsStatus} => Overall: ${overall}`;

  return {
    correctness,
    completeness: compStatus,
    determinism: detStatus,
    performance: performanceStatus,
    qualitySample: qsStatus,
    overall,
    summary,
  };
}

// ─── 5. Identity Resolvers ────────────────────────────────────────────────────────

export async function resolveEngineIdentity(): Promise<EngineIdentity> {
  let commitSha = "uncommitted/local";
  try {
    commitSha = execSync("git rev-parse HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {}

  let packageVersion = "0.1.0";
  try {
    const pkgJson = JSON.parse(await readFile(resolve(import.meta.dir, "..", "package.json"), "utf8"));
    packageVersion = pkgJson.version ?? "0.1.0";
  } catch {}

  return {
    commitSha,
    packageVersion,
    bunVersion: `bun-${bunVersion}`,
    os: platform,
    arch,
    schemaVersion: 2,
  };
}

export function resolveRepositoryIdentity(manifest: BenchmarkManifest, repoPath: string): RepositoryIdentity {
  let commitSha: string | undefined = manifest.revision;
  try {
    commitSha = execSync("git rev-parse HEAD", { cwd: repoPath, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {}

  let tag: string | undefined;
  try {
    tag = execSync("git describe --tags --exact-match", { cwd: repoPath, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {}

  const isSelfAnalysis = manifest.isSelfAnalysis === true || manifest.name === "legacy-exodus-core";
  const tier = manifest.tier ?? (isSelfAnalysis ? "self-analysis" : manifest.sizeClass === "large" ? "tier-2" : "tier-1");

  return {
    name: manifest.name,
    repositoryUrl: manifest.repository,
    revision: manifest.revision,
    commitSha,
    tag,
    tier,
    isSelfAnalysis,
    languageProfile: manifest.languageProfile,
    frameworkProfile: manifest.frameworkProfile,
    license: manifest.license,
  };
}
