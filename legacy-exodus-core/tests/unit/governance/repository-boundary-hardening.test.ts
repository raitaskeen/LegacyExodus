/**
 * Phase 3A / Track 3 / Milestone P1.6
 *
 * Repository Boundary & Execution-Context Hardening Test Suite
 *
 * Verifies:
 * A. Git-root vs Package-root execution path resolution
 * B. Internal benchmark artifact path anchoring (RESULTS_DIR, CACHE_DIR, CORPUS_DIR, FIDELITY_RESULTS_DIR)
 * C. Fidelity output path resolution always targeting canonical location
 * D. No root-level leakage (LegacyExodus/benchmarks or LegacyExodus/tests)
 * E. Ordinary user-supplied relative path semantics (resolving against caller CWD)
 * F. Absolute path preservation semantics
 * G. Windows and POSIX path normalization
 * H. Deterministic repeated behavior across invocations
 *
 * Failure-First Cases (1-7):
 * 1. No root-level benchmark output produced
 * 2. No root-level test infrastructure produced
 * 3. No arbitrary relative user path is redirected to benchmark cache
 * 4. No absolute path is rewritten unexpectedly
 * 5. Canonical benchmark paths do not depend on CWD
 * 6. Missing required benchmark resources fail loudly with explicit errors
 * 7. Invalid paths do not create partial directory trees unexpectedly
 */

import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize, resolve } from "node:path";

import {
  BENCHMARKS_ROOT,
  CACHE_DIR,
  CORPUS_DIR,
  FIDELITY_REPORT_FILE,
  FIDELITY_RESULTS_DIR,
  PACKAGE_ROOT,
  RESULTS_DIR,
  resolveBenchmarkRepoPath,
  resolveFidelityResultsDir,
  resolveResultsDir,
} from "../../../benchmarks/paths";
import { runFidelityValidation } from "../../../benchmarks/fidelity/runner";
import type { GroundTruthFact } from "@contracts/fidelity";

describe("Milestone P1.6 — Repository Boundary & Execution-Context Hardening", () => {
  const gitRoot = resolve(PACKAGE_ROOT, "..");

  // ─── Scenario A & B: Canonical Path Anchors ───────────────────────────────
  it("A/B: anchors canonical benchmark infrastructure to legacy-exodus-core regardless of CWD", () => {
    expect(PACKAGE_ROOT.endsWith("legacy-exodus-core")).toBe(true);
    expect(BENCHMARKS_ROOT).toBe(resolve(PACKAGE_ROOT, "benchmarks"));
    expect(RESULTS_DIR).toBe(resolve(PACKAGE_ROOT, "benchmarks", "results"));
    expect(CACHE_DIR).toBe(resolve(PACKAGE_ROOT, "benchmarks", ".cache"));
    expect(CORPUS_DIR).toBe(resolve(PACKAGE_ROOT, "benchmarks", "corpus"));
    expect(FIDELITY_RESULTS_DIR).toBe(resolve(RESULTS_DIR, "fidelity"));
    expect(FIDELITY_REPORT_FILE).toBe(resolve(FIDELITY_RESULTS_DIR, "fidelity-report.json"));
  });

  // ─── Scenario C & D: Fidelity Output Path & No Root Leakage ───────────────
  it("C/D: writes fidelity validation report canonically to package root, not Git root", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "boundary-test-"));
    try {
      const discoveryDir = join(tempDir, ".discovery");
      await mkdir(discoveryDir, { recursive: true });

      const gt: readonly GroundTruthFact[] = [
        {
          id: "gt-1",
          category: "file",
          attributes: { path: "src/index.js", language: "javascript" },
          provenance: "GROUND_TRUTH_SOURCE",
          sourceDescription: "index.js",
          migrationRelevance: "File existence",
        },
      ];

      // Direct in-memory predictions
      const predictions = {
        files: [{ path: "src/index.js", language: "javascript" }],
      };

      const report = await runFidelityValidation({
        repoPath: tempDir,
        groundTruth: gt,
        predictions,
        targetName: "boundary-check",
        closedScopeFilePaths: ["src/index.js"],
      });

      expect(report.targetName).toBe("boundary-check");
      expect(report.overallTruePositives).toBe(1);

      // Verify canonical destination exists
      expect(existsSync(FIDELITY_REPORT_FILE)).toBe(true);

      // Verify NO leakage to Git root
      const rootBenchmarks = join(gitRoot, "benchmarks");
      const rootTests = join(gitRoot, "tests");
      expect(existsSync(rootBenchmarks)).toBe(false);
      expect(existsSync(rootTests)).toBe(false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // ─── Scenario E: Ordinary User Path Semantics ──────────────────────────────
  it("E: preserves ordinary user-supplied relative path semantics relative to caller CWD", () => {
    const userPath1 = "./my-project";
    const userPath2 = "../external-repo";
    const userPath3 = "some/nested/project";

    expect(resolveBenchmarkRepoPath(userPath1)).toBe(resolve(userPath1));
    expect(resolveBenchmarkRepoPath(userPath2)).toBe(resolve(userPath2));
    expect(resolveBenchmarkRepoPath(userPath3)).toBe(resolve(userPath3));

    // Crucial invariant: ordinary user paths MUST NOT be redirected into .cache
    expect(resolveBenchmarkRepoPath(userPath1).includes(".cache")).toBe(false);
    expect(resolveBenchmarkRepoPath(userPath2).includes(".cache")).toBe(false);
  });

  // ─── Scenario F: Absolute Path Semantics ───────────────────────────────────
  it("F: preserves absolute paths unchanged", () => {
    const abs1 = resolve("c:/Users/Test/Repo");
    const abs2 = resolve("/tmp/test/repo");

    expect(resolveBenchmarkRepoPath(abs1)).toBe(normalize(abs1));
    expect(resolveBenchmarkRepoPath(abs2)).toBe(normalize(abs2));
    expect(resolveResultsDir(abs1)).toBe(normalize(abs1));
    expect(resolveFidelityResultsDir(abs1)).toBe(normalize(abs1));
  });

  // ─── Scenario G: Windows and POSIX Path Normalization ──────────────────────
  it("G: handles Windows and POSIX path separators deterministically for internal benchmark paths", () => {
    // POSIX format
    const posixCache = "benchmarks/.cache/fastify";
    const posixResults = "benchmarks/results/fidelity";
    const posixCorpus = "benchmarks/corpus/tier-1/cookie-parser.json";

    expect(resolveBenchmarkRepoPath(posixCache)).toBe(resolve(CACHE_DIR, "fastify"));
    expect(resolveBenchmarkRepoPath(posixResults)).toBe(resolve(RESULTS_DIR, "fidelity"));
    expect(resolveBenchmarkRepoPath(posixCorpus)).toBe(resolve(CORPUS_DIR, "tier-1/cookie-parser.json"));

    // Windows format
    const winCache = "benchmarks\\.cache\\fastify";
    const winResults = "benchmarks\\results\\fidelity";
    const winCorpus = "benchmarks\\corpus\\tier-1\\cookie-parser.json";

    expect(resolveBenchmarkRepoPath(winCache)).toBe(resolve(CACHE_DIR, "fastify"));
    expect(resolveBenchmarkRepoPath(winResults)).toBe(resolve(RESULTS_DIR, "fidelity"));
    expect(resolveBenchmarkRepoPath(winCorpus)).toBe(resolve(CORPUS_DIR, "tier-1/cookie-parser.json"));

    // Short format (.cache/...)
    expect(resolveBenchmarkRepoPath(".cache/express")).toBe(resolve(CACHE_DIR, "express"));
    expect(resolveBenchmarkRepoPath(".cache\\express")).toBe(resolve(CACHE_DIR, "express"));
  });

  // ─── Scenario H: Deterministic Repeated Behavior ───────────────────────────
  it("H: produces string-identical path resolutions on repeated calls", () => {
    for (let i = 0; i < 5; i++) {
      expect(resolveBenchmarkRepoPath("benchmarks/.cache/fastify")).toBe(resolve(CACHE_DIR, "fastify"));
      expect(resolveResultsDir()).toBe(RESULTS_DIR);
      expect(resolveFidelityResultsDir()).toBe(FIDELITY_RESULTS_DIR);
    }
  });

  // ─── Failure-First Tests (FF1 - FF7) ──────────────────────────────────────
  describe("Failure-First Governance Assertions", () => {
    it("FF1: verifies no root-level benchmarks/ directory exists after standard operations", () => {
      expect(existsSync(join(gitRoot, "benchmarks"))).toBe(false);
    });

    it("FF2: verifies no root-level tests/ directory exists after standard operations", () => {
      expect(existsSync(join(gitRoot, "tests"))).toBe(false);
    });

    it("FF3: failure-first - ensures non-benchmark paths never match benchmark cache", () => {
      const nonBenchmarkPaths = [
        "cache/my-app",
        "my-benchmarks/.cache/app",
        "./benchmarks_test/results",
        "src/benchmarks/.cache/app",
      ];
      for (const p of nonBenchmarkPaths) {
        const resolved = resolveBenchmarkRepoPath(p);
        expect(resolved).toBe(resolve(p));
        expect(resolved.startsWith(CACHE_DIR)).toBe(false);
      }
    });

    it("FF4: failure-first - ensures absolute paths outside package are never altered", () => {
      const foreignAbsPath = resolve(tmpdir(), "foreign-repo");
      expect(resolveBenchmarkRepoPath(foreignAbsPath)).toBe(normalize(foreignAbsPath));
    });

    it("FF5: failure-first - verifies canonical benchmark paths do not fluctuate with CWD", () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(gitRoot);
        const fromGitRoot = resolveBenchmarkRepoPath("benchmarks/.cache/fastify");

        process.chdir(PACKAGE_ROOT);
        const fromPkgRoot = resolveBenchmarkRepoPath("benchmarks/.cache/fastify");

        expect(fromGitRoot).toBe(fromPkgRoot);
        expect(fromGitRoot).toBe(resolve(CACHE_DIR, "fastify"));
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("FF6: failure-first - missing required discovery manifest throws loud, explicit error", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "missing-manifest-"));
      try {
        await expect(
          runFidelityValidation({ repoPath: tempDir }),
        ).rejects.toThrow(/Missing required discovery manifest/);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it("FF7: failure-first - invalid path resolution does not create stray directories", () => {
      const query = resolveBenchmarkRepoPath("benchmarks/.cache/nonexistent-query-only");
      expect(existsSync(query)).toBe(false);
      expect(existsSync(join(gitRoot, "benchmarks"))).toBe(false);
    });
  });
});
