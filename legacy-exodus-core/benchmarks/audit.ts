/**
 * Phase 3A — Benchmark System Self-Audit Suite
 *
 * Audits the benchmark infrastructure itself against 8 governed integrity checks:
 * 1. Core Architectural Isolation (Zero benchmark imports in src/)
 * 2. Git Hygiene & Cache Exclusions
 * 3. Manifest Revision Pinning Integrity
 * 4. Mathematical File Accounting Invariant
 * 5. Multi-run Semantic Determinism
 * 6. Quality Sampling Determinism & Reproducibility
 * 7. Contamination Guard Verification
 * 8. Health Score Aggregator Invariants
 *
 * Every check must do its work on real inputs. A check whose inputs are missing,
 * empty or unreadable could not run, and an unrunnable check is a CRITICAL failure,
 * never a pass. Checks 4–6 analyze benchmarks/fixtures/governance-audit, a small
 * checked-in fixture pinned by governance-audit.pin.json, so the audit needs no
 * network access or downloaded corpus.
 */

import { createHash } from "node:crypto";
import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { executeBenchmarkRun } from "./harness";
import { verifyDeterminism } from "./determinism";
import { computeFileAccounting, computeHealthScore, detectContamination, verifyCompleteness, resolveEngineIdentity } from "./governance";
import { generateQualitySample } from "./sample";
import { PACKAGE_ROOT } from "./paths";
import type {
  AnalysisDisposition,
  AuditCheckResult,
  AuditFinding,
  BenchmarkAuditReport,
  BenchmarkManifest,
  BenchmarkRunResult,
  GateStatus,
} from "./types";

const FIXTURE_NAME = "governance-audit";
const FIXTURE_RUNS = 3;
const SAMPLE_SIZE = 5;
const SAMPLE_SEED = 42;
const ALTERNATE_SAMPLE_SEEDS = [999, 2024, 31337];
// Fixed sampling identities keep the sampling check reproducible across engine commits.
const SAMPLE_REPO_ID = "governance-audit-fixture";
const SAMPLE_ENGINE_ID = "governance-audit-sampler";

type CheckOutcome =
  | { readonly passed: true; readonly evidence: string }
  | { readonly passed: false; readonly evidence: string; readonly findings: readonly [AuditFinding, ...AuditFinding[]] };

interface GovernedCheck {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly run: () => Promise<CheckOutcome>;
}

interface FixtureRuns {
  readonly pinnedFileCount: number;
  readonly runs: readonly BenchmarkRunResult[];
  readonly discoveryDir: string;
}

export async function runBenchmarkSelfAudit(baseDir = PACKAGE_ROOT): Promise<BenchmarkAuditReport> {
  const engineIdentity = await resolveEngineIdentity();
  const workDir = await mkdtemp(join(tmpdir(), "legacy-exodus-audit-fixture-"));

  // Checks 4–6 share one isolated set of fixture runs; a failure to produce them fails all three.
  let fixtureRuns: Promise<FixtureRuns> | undefined;
  const requireFixtureRuns = (): Promise<FixtureRuns> => (fixtureRuns ??= runPinnedFixture(baseDir, workDir));

  const checks: readonly GovernedCheck[] = [
    // ─── Check 1: Core Architectural Isolation ──────────────────────────────────
    {
      id: "core-isolation",
      name: "Core Architectural Isolation",
      category: "Core Isolation",
      run: async () => {
        const srcDir = resolve(baseDir, "src");
        const srcFiles = await findSourceFiles(srcDir);
        if (srcFiles.length === 0) {
          throw new Error(`No .ts or .js source files found under ${srcDir}`);
        }
        const violations: AuditFinding[] = [];
        for (const f of srcFiles) {
          const content = await readFile(f, "utf8");
          if (content.includes("from \"../benchmarks") || content.includes("from \"../../benchmarks") || content.includes("from \"@benchmarks")) {
            violations.push({
              category: "Core Isolation",
              severity: "CRITICAL",
              description: `Production source file ${f} imports from benchmarks/`,
              evidence: `Found benchmark import in ${f}`,
              remediation: "Remove benchmark imports from src/",
            });
          }
        }
        const [first, ...rest] = violations;
        if (first === undefined) {
          return pass(`Scanned ${srcFiles.length} source files under src/; none import benchmarks/`);
        }
        return fail(`${violations.length} of ${srcFiles.length} source files import benchmarks/`, first, ...rest);
      },
    },

    // ─── Check 2: Git Hygiene & Cache Exclusions ─────────────────────────────────
    {
      id: "git-hygiene",
      name: "Git Hygiene & Cache Exclusions",
      category: "Git Hygiene",
      run: async () => {
        const candidates = [
          resolve(baseDir, ".gitignore"),
          resolve(baseDir, "..", ".gitignore"),
          resolve(baseDir, "benchmarks/.gitignore"),
        ];
        const excludedBy: string[] = [];
        for (const candidate of candidates) {
          const content = await readFile(candidate, "utf8").catch(() => "");
          if (content.includes(".cache")) excludedBy.push(candidate);
        }
        if (excludedBy.length > 0) {
          return pass(`benchmarks/.cache is excluded by ${excludedBy.join(", ")}`);
        }
        return fail("No .gitignore in the package, its parent or benchmarks/ excludes .cache", {
          category: "Git Hygiene",
          severity: "HIGH",
          description: "benchmarks/.cache is not explicitly listed in .gitignore",
          evidence: "Missing .cache in .gitignore",
          remediation: "Add .cache to benchmarks/.gitignore",
        });
      },
    },

    // ─── Check 3: Manifest Revision Pinning Integrity ────────────────────────────
    {
      id: "manifest-pinning",
      name: "Manifest Revision Pinning Integrity",
      category: "Revision Integrity",
      run: async () => {
        const corpusDir = resolve(baseDir, "benchmarks/corpus");
        const corpusFiles = await findJsonFiles(corpusDir);
        if (corpusFiles.length === 0) {
          throw new Error(`No benchmark corpus manifests found under ${corpusDir}`);
        }
        const unpinned: AuditFinding[] = [];
        for (const cf of corpusFiles) {
          const manifest = JSON.parse(await readFile(cf, "utf8")) as BenchmarkManifest;
          if (!manifest.isSelfAnalysis && manifest.name !== "legacy-exodus-core" && !manifest.revision) {
            unpinned.push({
              category: "Revision Integrity",
              severity: "HIGH",
              description: `Manifest ${manifest.name} is missing a pinned git revision`,
              evidence: `File: ${cf}`,
              remediation: "Pin an exact git tag or commit SHA in manifest.revision",
            });
          }
        }
        const [first, ...rest] = unpinned;
        if (first === undefined) {
          return pass(`${corpusFiles.length} corpus manifests checked; every external manifest pins a revision`);
        }
        return fail(`${unpinned.length} of ${corpusFiles.length} corpus manifests are unpinned`, first, ...rest);
      },
    },

    // ─── Check 4: Mathematical Accounting Invariant on Pinned Fixture ────────────
    {
      id: "fixture-accounting",
      name: "Mathematical File Accounting Invariant",
      category: "Correctness",
      run: async () => {
        const fixture = await requireFixtureRuns();
        const problems: string[] = [];
        fixture.runs.forEach((run, i) => {
          const accounting = run.fileAccounting;
          if (accounting.filesDiscovered !== fixture.pinnedFileCount) {
            problems.push(`Run ${i + 1} discovered ${accounting.filesDiscovered} of ${fixture.pinnedFileCount} pinned files`);
          }
          if (!accounting.reconciles || accounting.discrepancy !== 0) {
            problems.push(`Run ${i + 1} discovered ${accounting.filesDiscovered} but accounted for ${accounting.computedTotal}`);
          }
        });
        const first = fixture.runs[0];
        if (problems.length === 0 && first !== undefined) {
          const breakdown = first.fileAccounting.breakdown;
          return pass(
            `${fixture.runs.length} runs each discovered and accounted for all ${fixture.pinnedFileCount} pinned files ` +
            `(${breakdown.analyzed} analyzed, ${breakdown.nonSourceArtifacts} non-source)`,
          );
        }
        return fail(problems.join("; "), {
          category: "Correctness",
          severity: "CRITICAL",
          description: `File accounting invariant failed on the ${FIXTURE_NAME} fixture`,
          evidence: problems.join("; "),
          remediation: "Audit file classification pipeline in DiscoveryEngine",
        });
      },
    },

    // ─── Check 5: Multi-run Semantic Determinism ─────────────────────────────────
    {
      id: "fixture-determinism",
      name: "Multi-run Semantic Determinism",
      category: "Determinism",
      run: async () => {
        const fixture = await requireFixtureRuns();
        const [first, ...rest] = fixture.runs;
        if (first === undefined || rest.length === 0) {
          throw new Error(`Determinism needs at least two fixture runs; got ${fixture.runs.length}`);
        }
        if (first.artifactHashes.length === 0) {
          throw new Error(`Fixture run produced no discovery artifacts to compare`);
        }
        const expectedNames = artifactNames(first);
        const problems: string[] = [];
        rest.forEach((run, i) => {
          const names = artifactNames(run);
          if (names !== expectedNames) {
            problems.push(`Run ${i + 2} produced artifacts [${names}] instead of [${expectedNames}]`);
          }
        });
        const detReport = verifyDeterminism(fixture.runs);
        problems.push(...detReport.semanticDifferences);
        if (problems.length === 0 && detReport.allDeterministic) {
          return pass(`${fixture.runs.length} runs produced identical SHA-256 digests for ${first.artifactHashes.length} artifacts`);
        }
        return fail(problems.join("; "), {
          category: "Determinism",
          severity: "CRITICAL",
          description: `Multi-run determinism verification failed on the ${FIXTURE_NAME} fixture`,
          evidence: problems.join("; "),
          remediation: "Ensure all map keys, set iterations, and ID generation are canonical",
        });
      },
    },

    // ─── Check 6: Deterministic Quality Sampling Reproducibility ─────────────────
    {
      id: "sampling-reproducibility",
      name: "Quality Sampling Determinism & Reproducibility",
      category: "Sampling Integrity",
      run: async () => {
        const fixture = await requireFixtureRuns();
        const sample = (seed: number) =>
          generateQualitySample(fixture.discoveryDir, SAMPLE_REPO_ID, SAMPLE_ENGINE_ID, SAMPLE_SIZE, seed);

        const primary = await sample(SAMPLE_SEED);
        const population = primary.population.totalResolvedCalls;
        if (population <= SAMPLE_SIZE) {
          throw new Error(`Fixture yields ${population} resolved calls; seed sensitivity needs more than ${SAMPLE_SIZE}`);
        }
        const repeat = await sample(SAMPLE_SEED);
        const reproducible = JSON.stringify(primary) === JSON.stringify(repeat);
        const primaryCalls = JSON.stringify(primary.sampledResolvedCalls);
        let seedSensitive = false;
        for (const seed of ALTERNATE_SAMPLE_SEEDS) {
          if (JSON.stringify((await sample(seed)).sampledResolvedCalls) !== primaryCalls) seedSensitive = true;
        }

        if (reproducible && seedSensitive) {
          return pass(
            `Seed ${SAMPLE_SEED} reproduced an identical ${SAMPLE_SIZE}-of-${population} resolved-call sample; ` +
            `alternate seeds selected a different sample`,
          );
        }
        const evidence = [
          reproducible ? undefined : `Sample run 1 != sample run 2 for seed ${SAMPLE_SEED}`,
          seedSensitive ? undefined : `Seeds ${ALTERNATE_SAMPLE_SEEDS.join(", ")} all reproduced the seed ${SAMPLE_SEED} sample`,
        ].filter((line) => line !== undefined).join("; ");
        return fail(evidence, {
          category: "Sampling Integrity",
          severity: "HIGH",
          description: "Quality sampling is non-deterministic or ignores seeds",
          evidence,
          remediation: "Ensure pseudo-random number generator is strictly seeded from derivation hash",
        });
      },
    },

    // ─── Check 7: Contamination Guard Verification ───────────────────────────────
    {
      id: "contamination-guard",
      name: "Contamination Guard Verification",
      category: "Contamination Detection",
      run: async () => {
        const fakeDiscovered = [
          { path: "src/index.js" },
          { path: "benchmarks/.cache/repo/file.js" },
          { path: "node_modules/pkg/index.js" },
        ];
        const contam = detectContamination(fakeDiscovered);
        if (contam.isContaminated && contam.benchmarkArtifactsExcluded.length > 0 && contam.ignoredFiles.length > 0) {
          return pass(
            `Flagged ${contam.benchmarkArtifactsExcluded.length} benchmark-cache and ${contam.ignoredFiles.length} ignored-directory paths ` +
            `among ${fakeDiscovered.length} synthetic discovered paths`,
          );
        }
        return fail("Contamination guard missed benchmark cache or node_modules paths", {
          category: "Contamination Detection",
          severity: "HIGH",
          description: "Contamination guard failed to detect benchmark cache and node_modules in discovered paths",
          evidence: JSON.stringify(contam),
          remediation: "Update detectContamination pattern rules",
        });
      },
    },

    // ─── Check 8: Health Score Aggregator Invariants ─────────────────────────────
    {
      id: "health-score-invariants",
      name: "Health Score Aggregator Invariants",
      category: "Health Score",
      run: async () => {
        const invariants = checkHealthScoreInvariants();
        if (invariants.cases > 0 && invariants.problems.length === 0) {
          return pass(`${invariants.cases} synthetic aggregator cases produced their required overall status`);
        }
        return fail(invariants.problems.join("; "), {
          category: "Health Score",
          severity: "HIGH",
          description: "Health score aggregator violated a governance invariant",
          evidence: invariants.problems.join("; "),
          remediation: "Restore computeHealthScore gate precedence (FAIL over NEEDS_REVIEW over PASS)",
        });
      },
    },
  ];

  const results: AuditCheckResult[] = [];
  const findings: AuditFinding[] = [];
  try {
    for (const check of checks) {
      let outcome: CheckOutcome;
      try {
        outcome = await check.run();
      } catch (error: unknown) {
        outcome = cannotRun(check, error);
      }
      results.push({ id: check.id, name: check.name, passed: outcome.passed, evidence: outcome.evidence });
      if (!outcome.passed) findings.push(...outcome.findings);
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }

  // Verdict calculation
  const totalChecks = results.length;
  const passedChecks = results.filter((r) => r.passed).length;
  const failedChecks = totalChecks - passedChecks;
  let verdict: "PASS" | "PASS_WITH_CONDITIONS" | "NO_GO" = "PASS";
  if (findings.some((f) => f.severity === "CRITICAL")) {
    verdict = "NO_GO";
  } else if (findings.length > 0 || failedChecks > 0) {
    verdict = "PASS_WITH_CONDITIONS";
  }

  return {
    auditedAt: new Date().toISOString(),
    engineSha: engineIdentity.commitSha,
    totalChecks,
    passedChecks,
    failedChecks,
    checks: results,
    findings,
    verdict,
  };
}

/** The audit gate passes only when every governed check ran and passed. */
export function isAuditPassing(report: BenchmarkAuditReport): boolean {
  return report.verdict === "PASS" && report.totalChecks > 0 && report.passedChecks === report.totalChecks && report.failedChecks === 0;
}

function pass(evidence: string): CheckOutcome {
  return { passed: true, evidence };
}

function fail(evidence: string, first: AuditFinding, ...rest: AuditFinding[]): CheckOutcome {
  return { passed: false, evidence, findings: [first, ...rest] };
}

function cannotRun(check: GovernedCheck, error: unknown): CheckOutcome {
  const reason = error instanceof Error ? error.message : String(error);
  return fail(`Could not run: ${reason}`, {
    category: check.category,
    severity: "CRITICAL",
    description: `${check.name} check could not run; an unrunnable check is a failed check`,
    evidence: reason,
    remediation: "Restore the check's inputs; never count an unrunnable check as passed",
  });
}

// ─── Pinned Governance Fixture ────────────────────────────────────────────────

async function runPinnedFixture(baseDir: string, workDir: string): Promise<FixtureRuns> {
  const fixturesDir = resolve(baseDir, "benchmarks", "fixtures");
  const fixtureDir = join(fixturesDir, FIXTURE_NAME);
  const pinnedFiles = parseFixturePin(await readFile(join(fixturesDir, `${FIXTURE_NAME}.pin.json`), "utf8"));
  await verifyFixtureMatchesPin(fixtureDir, pinnedFiles);

  // Analyze an isolated copy so runs never see stale artifacts or write into the source tree.
  const projectDir = join(workDir, FIXTURE_NAME);
  await cp(fixtureDir, projectDir, { recursive: true });
  const discoveryDir = join(projectDir, ".discovery");
  const runs: BenchmarkRunResult[] = [];
  for (let i = 0; i < FIXTURE_RUNS; i++) {
    await rm(discoveryDir, { recursive: true, force: true });
    runs.push(await executeBenchmarkRun(projectDir, i));
  }
  return { pinnedFileCount: pinnedFiles.size, runs, discoveryDir };
}

function parseFixturePin(raw: string): ReadonlyMap<string, string> {
  const parsed: unknown = JSON.parse(raw);
  const files = typeof parsed === "object" && parsed !== null && "files" in parsed ? parsed.files : undefined;
  if (typeof files !== "object" || files === null) {
    throw new Error(`${FIXTURE_NAME}.pin.json has no "files" map`);
  }
  const pinned = new Map<string, string>();
  for (const [path, digest] of Object.entries(files)) {
    if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)) {
      throw new Error(`${FIXTURE_NAME}.pin.json has an invalid SHA-256 digest for ${path}`);
    }
    pinned.set(path, digest);
  }
  if (pinned.size === 0) {
    throw new Error(`${FIXTURE_NAME}.pin.json pins no files`);
  }
  return pinned;
}

async function verifyFixtureMatchesPin(fixtureDir: string, pinnedFiles: ReadonlyMap<string, string>): Promise<void> {
  const actualFiles = await listFilesRelative(fixtureDir);
  const missing = [...pinnedFiles.keys()].filter((path) => !actualFiles.includes(path));
  const unexpected = actualFiles.filter((path) => !pinnedFiles.has(path));
  const changed: string[] = [];
  for (const [path, digest] of pinnedFiles) {
    if (missing.includes(path)) continue;
    const content = (await readFile(join(fixtureDir, path), "utf8")).replace(/\r\n/g, "\n");
    if (createHash("sha256").update(content).digest("hex") !== digest) changed.push(path);
  }
  const problems = [
    missing.length > 0 ? `missing ${missing.join(", ")}` : undefined,
    unexpected.length > 0 ? `unpinned ${unexpected.join(", ")}` : undefined,
    changed.length > 0 ? `digest mismatch ${changed.join(", ")}` : undefined,
  ].filter((problem) => problem !== undefined);
  if (problems.length > 0) {
    throw new Error(`Fixture ${FIXTURE_NAME} does not match its pin: ${problems.join("; ")}`);
  }
}

async function listFilesRelative(dir: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...await listFilesRelative(join(dir, entry.name), relativePath));
    } else {
      files.push(relativePath);
    }
  }
  return files.sort();
}

function artifactNames(run: BenchmarkRunResult): string {
  return run.artifactHashes.map((a) => a.name).sort().join(", ");
}

// ─── Health Score Aggregator Invariants ───────────────────────────────────────

function checkHealthScoreInvariants(): { readonly cases: number; readonly problems: readonly string[] } {
  const clean: AnalysisDisposition = {
    filesDiscovered: 3,
    filesAnalyzed: 2,
    parserFailures: 0,
    symbolExtractionFailures: 0,
    secondPassFailures: 0,
    unsupportedFiles: 0,
    nonSourceArtifacts: 1,
    unclassifiedArtifacts: 0,
    enumerationFailures: 0,
    discoveryComplete: true,
    durationMs: 0,
  };
  const discrepancy: AnalysisDisposition = { ...clean, filesDiscovered: 4 };
  const parserFailure: AnalysisDisposition = { ...clean, filesAnalyzed: 1, parserFailures: 1 };
  const noContamination = detectContamination([{ path: "src/index.js" }]);
  const score = (disposition: AnalysisDisposition, determinismPassed: boolean, regressed = false): GateStatus => {
    const accounting = computeFileAccounting(disposition);
    const completeness = verifyCompleteness(disposition, accounting, noContamination);
    return computeHealthScore(accounting, completeness, determinismPassed, regressed ? "REGRESSED" : "STABLE").overall;
  };

  const cases: readonly { readonly label: string; readonly expected: GateStatus; readonly actual: GateStatus }[] = [
    { label: "clean run", expected: "PASS", actual: score(clean, true) },
    { label: "accounting discrepancy", expected: "FAIL", actual: score(discrepancy, true) },
    { label: "non-deterministic run", expected: "FAIL", actual: score(clean, false) },
    { label: "parser failure", expected: "NEEDS_REVIEW", actual: score(parserFailure, true) },
    { label: "performance regression", expected: "NEEDS_REVIEW", actual: score(clean, true, true) },
  ];
  const problems = cases
    .filter((c) => c.actual !== c.expected)
    .map((c) => `${c.label}: expected ${c.expected}, got ${c.actual}`);
  return { cases: cases.length, problems };
}

async function findSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git") {
      files.push(...await findSourceFiles(full));
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
      files.push(full);
    }
  }
  return files;
}

async function findJsonFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findJsonFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(full);
    }
  }
  return files;
}
