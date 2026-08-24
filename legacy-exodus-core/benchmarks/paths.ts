/**
 * Phase 3A / P1.6 — Centralized Canonical Benchmark Paths & Resolvers
 *
 * Anchors all internal benchmark caches, results, corpus manifests, and fidelity
 * output directories to the canonical package root (legacy-exodus-core), ensuring
 * execution is independent of the caller's working directory (CWD).
 */

import { isAbsolute, normalize, resolve } from "node:path";

/**
 * Canonical package root directory (legacy-exodus-core)
 */
export const PACKAGE_ROOT: string = resolve(import.meta.dir, "..");

/**
 * Canonical benchmark root directory (legacy-exodus-core/benchmarks)
 */
export const BENCHMARKS_ROOT: string = resolve(import.meta.dir);

/**
 * Canonical benchmark results directory (legacy-exodus-core/benchmarks/results)
 */
export const RESULTS_DIR: string = resolve(BENCHMARKS_ROOT, "results");

/**
 * Canonical benchmark cache directory (legacy-exodus-core/benchmarks/.cache)
 */
export const CACHE_DIR: string = resolve(BENCHMARKS_ROOT, ".cache");

/**
 * Canonical benchmark corpus directory (legacy-exodus-core/benchmarks/corpus)
 */
export const CORPUS_DIR: string = resolve(BENCHMARKS_ROOT, "corpus");

/**
 * Canonical fidelity results directory (legacy-exodus-core/benchmarks/results/fidelity)
 */
export const FIDELITY_RESULTS_DIR: string = resolve(RESULTS_DIR, "fidelity");

/**
 * Canonical fidelity report file path
 */
export const FIDELITY_REPORT_FILE: string = resolve(FIDELITY_RESULTS_DIR, "fidelity-report.json");

/**
 * Resolves a repository path for benchmark and fidelity operations.
 *
 * Rules:
 * 1. Absolute paths are preserved unchanged.
 * 2. Internal recognized benchmark paths (starting with `benchmarks/.cache`, `.cache`,
 *    `benchmarks/results`, `benchmarks/corpus`) are normalized to the canonical package root.
 * 3. Ordinary user-supplied relative paths (e.g. `./my-repo`, `../test-repo`) preserve
 *    standard caller-CWD resolution semantics.
 */
export function resolveBenchmarkRepoPath(repoPath: string): string {
  if (!repoPath) {
    return repoPath;
  }

  // Preserve absolute paths unchanged
  if (isAbsolute(repoPath)) {
    return normalize(repoPath);
  }

  const normalized = repoPath.replace(/\\/g, "/");

  // Recognized internal benchmark cache paths
  if (normalized.startsWith("benchmarks/.cache/")) {
    return resolve(BENCHMARKS_ROOT, normalized.slice("benchmarks/".length));
  }
  if (normalized.startsWith(".cache/")) {
    return resolve(BENCHMARKS_ROOT, normalized);
  }

  // Recognized internal benchmark results / corpus paths
  if (normalized.startsWith("benchmarks/results/")) {
    return resolve(BENCHMARKS_ROOT, normalized.slice("benchmarks/".length));
  }
  if (normalized.startsWith("benchmarks/corpus/")) {
    return resolve(BENCHMARKS_ROOT, normalized.slice("benchmarks/".length));
  }

  // Ordinary user-supplied relative path -> resolve against caller's CWD
  return resolve(repoPath);
}

/**
 * Resolves a benchmark results directory.
 * If customDir is specified:
 *   - if absolute: return normalized
 *   - if matches internal "benchmarks/results": anchor to canonical package results dir
 *   - otherwise: resolve against caller's CWD
 * If customDir is omitted, returns the canonical RESULTS_DIR.
 */
export function resolveResultsDir(customDir?: string): string {
  if (!customDir) {
    return RESULTS_DIR;
  }
  if (isAbsolute(customDir)) {
    return normalize(customDir);
  }
  const normalized = customDir.replace(/\\/g, "/");
  if (normalized === "benchmarks/results" || normalized.startsWith("benchmarks/results/")) {
    return resolve(BENCHMARKS_ROOT, normalized.slice("benchmarks/".length));
  }
  return resolve(customDir);
}

/**
 * Resolves a fidelity results directory.
 * If customDir is specified:
 *   - if absolute: return normalized
 *   - if matches internal "benchmarks/results/fidelity": anchor to canonical package fidelity results dir
 *   - otherwise: resolve against caller's CWD
 * If customDir is omitted, returns the canonical FIDELITY_RESULTS_DIR.
 */
export function resolveFidelityResultsDir(customDir?: string): string {
  if (!customDir) {
    return FIDELITY_RESULTS_DIR;
  }
  if (isAbsolute(customDir)) {
    return normalize(customDir);
  }
  const normalized = customDir.replace(/\\/g, "/");
  if (normalized === "benchmarks/results/fidelity" || normalized.startsWith("benchmarks/results/fidelity/")) {
    return resolve(RESULTS_DIR, normalized.slice("benchmarks/results/".length));
  }
  return resolve(customDir);
}
