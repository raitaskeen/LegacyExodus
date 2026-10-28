/**
 * Phase 3A — Unified Benchmark Runner & Governance Orchestrator
 *
 * Orchestrates multi-run benchmark execution, mathematical file accounting,
 * semantic determinism gates, deterministic quality sampling, health scoring,
 * and persistent artifact recording.
 *
 * Usage:
 *   bun run benchmarks/runner.ts <manifest-or-repo> [--runs N] [--output-dir path] [--seed S]
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { executeBenchmarkRun } from "./harness";
import { verifyDeterminism } from "./determinism";
import {
  computeHealthScore,
  resolveEngineIdentity,
  resolveRepositoryIdentity,
} from "./governance";
import { generateQualitySample } from "./sample";
import { CACHE_DIR, RESULTS_DIR, resolveBenchmarkRepoPath, resolveResultsDir } from "./paths";
import { ensureCacheEntryVerified, ensurePinnedRepository } from "./scripts/acquire";
import type {
  BenchmarkManifest,
  BenchmarkResult,
  BenchmarkRunResult,
  PerformanceMetrics,
} from "./types";

export interface RunnerOptions {
  readonly target: string;
  readonly runs: number;
  readonly outputDir?: string;
  readonly sampleSize?: number;
  readonly sampleSeed?: number;
  /** Directory holding the acquired corpora. Defaults to benchmarks/.cache. */
  readonly cacheDir?: string;
}

export async function runBenchmark(options: RunnerOptions): Promise<BenchmarkResult> {
  const targetPath = resolveBenchmarkRepoPath(options.target);
  const cacheDir = options.cacheDir === undefined ? CACHE_DIR : resolve(options.cacheDir);
  let manifest: BenchmarkManifest;
  let repoPath: string;

  if (targetPath.endsWith(".json")) {
    manifest = JSON.parse(await readFile(targetPath, "utf8")) as BenchmarkManifest;
    if (manifest.localPath) {
      repoPath = resolve(dirname(targetPath), manifest.localPath);
    } else {
      repoPath = resolve(cacheDir, manifest.name);
      // A manifest with a repository is a pinned corpus (BA-20 / A6): a missing cache is acquired at the
      // pinned commit and an existing one is verified before any run uses it, exactly as the fidelity tests do.
      if (manifest.repository !== undefined) {
        await ensurePinnedRepository(manifest, repoPath);
      }
    }
  } else {
    const name = basename(targetPath);
    manifest = {
      name,
      sizeClass: "medium",
      languageProfile: ["javascript"],
      frameworkProfile: [],
      license: "unknown",
      reason: "Direct local benchmark execution",
      localPath: targetPath,
    };
    repoPath = targetPath;
  }

  // Whatever the manifest says, a path that lands inside the benchmark cache is a corpus checkout and is
  // verified against its corpus manifest before any run uses it (BA-20 / A6). A localPath into the cache, a
  // manifest without a repository, and a bare directory argument all end up here. Other local repositories
  // are the caller's own.
  await ensureCacheEntryVerified(repoPath, cacheDir);

  const engineIdentity = await resolveEngineIdentity();
  const repoIdentity = resolveRepositoryIdentity(manifest, repoPath);

  const runsCount = options.runs > 0 ? options.runs : 3;
  const outputBase = resolveResultsDir(options.outputDir);

  console.log(`\n╔══════════════════════════════════════════════════════════╗`);
  console.log(`║  LegacyExodus Phase 3A — Benchmark Orchestrator          ║`);
  console.log(`╚══════════════════════════════════════════════════════════╝\n`);
  console.log(`Repository:   ${repoIdentity.name} (${repoIdentity.tier})`);
  console.log(`Path:         ${repoPath}`);
  console.log(`Revision:     ${repoIdentity.revision ?? repoIdentity.commitSha ?? "unversioned"}`);
  console.log(`Engine SHA:   ${engineIdentity.commitSha.slice(0, 10)} (${engineIdentity.packageVersion})`);
  console.log(`Runs:         ${runsCount}`);
  console.log(`Self-Analysis: ${repoIdentity.isSelfAnalysis ? "YES" : "NO"}\n`);

  // Clean stale .discovery artifacts before initial run
  const discoveryDir = join(repoPath, ".discovery");
  try { await rm(discoveryDir, { recursive: true, force: true }); } catch {}

  const runs: BenchmarkRunResult[] = [];

  for (let i = 0; i < runsCount; i++) {
    console.log(`  Run ${i + 1}/${runsCount}...`);
    if (i > 0) {
      try { await rm(discoveryDir, { recursive: true, force: true }); } catch {}
    }

    const runResult = await executeBenchmarkRun(repoPath, i);
    runs.push(runResult);

    const d = runResult.disposition;
    const reconciles = runResult.fileAccounting.reconciles;
    console.log(`    ✓ ${d.filesDiscovered} discovered, ${d.filesAnalyzed} analyzed, ${d.parserFailures} failures, ${d.durationMs.toFixed(0)}ms`);
    console.log(`    ✓ File Accounting: ${reconciles ? "RECONCILES" : "FAILED DISCREPANCY: " + runResult.fileAccounting.discrepancy}`);
  }

  // ─── Determinism Verification ───────────────────────────────────────────────
  const determinism = verifyDeterminism(runs);
  console.log(`\n  Determinism: ${determinism.allDeterministic ? "✓ PASS" : "✗ FAIL"} (${determinism.totalRuns} runs)`);

  // ─── Quality Sampling ───────────────────────────────────────────────────────
  const sampleSize = options.sampleSize ?? 20;
  const sampleSeed = options.sampleSeed ?? 42;
  const qualitySample = await generateQualitySample(
    discoveryDir,
    repoIdentity.commitSha ?? "local",
    engineIdentity.commitSha,
    sampleSize,
    sampleSeed,
  );
  console.log(`  Quality Sampling: ${qualitySample.sampledResolvedCalls.length} resolved calls sampled (seed: ${sampleSeed})`);

  // ─── Performance Aggregation ────────────────────────────────────────────────
  const durations = runs.map((r) => r.disposition.durationMs);
  const avgDurationMs = durations.reduce((a, b) => a + b, 0) / durations.length;
  const minDurationMs = Math.min(...durations);
  const maxDurationMs = Math.max(...durations);
  const firstRun = runs[0]!;

  const filesPerSecond = avgDurationMs > 0 ? (firstRun.disposition.filesDiscovered / (avgDurationMs / 1000)) : 0;
  const analyzedFilesPerSecond = avgDurationMs > 0 ? (firstRun.disposition.filesAnalyzed / (avgDurationMs / 1000)) : 0;
  const msPerCfg = firstRun.flow.cfgCount > 0 ? avgDurationMs / firstRun.flow.cfgCount : 0;
  const msPerDfg = firstRun.flow.dfgCount > 0 ? avgDurationMs / firstRun.flow.dfgCount : 0;
  const peakRssMb = Math.max(...runs.map((r) => r.peakRssMb ?? 0));

  const performance: PerformanceMetrics = {
    avgDurationMs: Math.round(avgDurationMs * 10) / 10,
    minDurationMs: Math.round(minDurationMs * 10) / 10,
    maxDurationMs: Math.round(maxDurationMs * 10) / 10,
    filesPerSecond: Math.round(filesPerSecond * 10) / 10,
    analyzedFilesPerSecond: Math.round(analyzedFilesPerSecond * 10) / 10,
    msPerCfg: Math.round(msPerCfg * 100) / 100,
    msPerDfg: Math.round(msPerDfg * 100) / 100,
    peakRssMb,
  };

  // ─── Health Score ───────────────────────────────────────────────────────────
  const healthScore = computeHealthScore(
    firstRun.fileAccounting,
    firstRun.completeness,
    determinism.allDeterministic,
    "STABLE",
    true,
  );
  console.log(`  Health Gate: ${healthScore.summary}\n`);

  const warnings: string[] = [];
  if (!firstRun.fileAccounting.reconciles) {
    warnings.push(`File accounting discrepancy: ${firstRun.fileAccounting.discrepancy}`);
  }
  if (!determinism.allDeterministic) {
    warnings.push(`Determinism failures detected in artifacts: ${determinism.semanticDifferences.join(", ")}`);
  }

  const limitations: string[] = [
    "JavaScript / TypeScript lexical syntax only (CommonJS + ESM)",
    "Deterministic intra-procedural and inter-procedural flow bounded to proven calls",
  ];

  const nowIso = new Date().toISOString();
  const runId = `bm_${repoIdentity.name}_${nowIso.replace(/[:.]/g, "-")}`;

  const result: BenchmarkResult = {
    version: 2,
    id: runId,
    executedAt: nowIso,
    engine: engineIdentity,
    repository: repoIdentity,
    runs,
    determinism,
    performance,
    healthScore,
    qualitySample,
    warnings,
    limitations,
  };

  // Write JSON artifact
  const targetDir = join(outputBase, repoIdentity.name);
  await mkdir(targetDir, { recursive: true });
  const resultFile = join(targetDir, `${nowIso.replace(/[:.]/g, "-")}.json`);
  await writeFile(resultFile, JSON.stringify(result, null, 2), "utf8");
  console.log(`  Artifact written: ${resultFile}\n`);

  return result;
}

// ─── Direct CLI Invocations ───────────────────────────────────────────────────

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: bun run benchmarks/runner.ts <manifest-or-repo> [--runs N]");
    process.exit(1);
  }

  const target = args[0]!;
  let runs = 3;
  const runsIdx = args.indexOf("--runs");
  if (runsIdx !== -1 && args[runsIdx + 1]) {
    runs = parseInt(args[runsIdx + 1]!, 10);
  }

  runBenchmark({ target, runs }).catch((err) => {
    console.error("Benchmark failed:", err);
    process.exit(1);
  });
}
