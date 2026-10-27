/**
 * F-010 — Benchmark governance audit must be able to fail.
 *
 * The self-audit is a merge gate (CI "Benchmark Governance Audit" step and the
 * `verify` composite). A check that cannot run, or that has no data to judge,
 * is a failure; it must never be counted as passed, and the audit must exit
 * non-zero unless every governed check passed.
 */

import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { appendFile, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { BenchmarkAuditReport } from "../../../benchmarks/types";

const PACKAGE_ROOT = resolve(import.meta.dir, "../../..");
const BENCHMARK_CLI = join(PACKAGE_ROOT, "benchmarks", "cli.ts");
const AUDIT_MODULE = join(PACKAGE_ROOT, "benchmarks", "audit.ts");
const AUDIT_TIMEOUT_MS = 120_000;

// Calls the exported runBenchmarkSelfAudit(baseDir) in a child process. Importing the
// audit module here would pull benchmark files outside the tsconfig scope into typecheck.
const AUDIT_DRIVER = [
  "const [modulePath, baseDir] = process.argv.slice(-2);",
  "const { runBenchmarkSelfAudit } = await import(modulePath);",
  "process.stdout.write(JSON.stringify(await runBenchmarkSelfAudit(baseDir)));",
].join("\n");

// Governed checks in execution order.
const GOVERNED_CHECK_IDS = [
  "core-isolation",
  "git-hygiene",
  "manifest-pinning",
  "fixture-accounting",
  "fixture-determinism",
  "sampling-reproducibility",
  "contamination-guard",
  "health-score-invariants",
];

// Only these checks exercise governance functions on built-in synthetic inputs;
// every other check needs workspace inputs and must fail when they are absent.
const SELF_CONTAINED_CHECK_IDS = ["contamination-guard", "health-score-invariants"];

const FIXTURE_CHECK_IDS = ["fixture-accounting", "fixture-determinism", "sampling-reproducibility"];

async function withWorkspace<T>(fn: (workspace: string) => Promise<T>): Promise<T> {
  // Nest the workspace so the audit's parent-directory .gitignore lookup stays inside our temp dir.
  const container = await mkdtemp(join(tmpdir(), "legacy-exodus-audit-"));
  const workspace = join(container, "workspace");
  await mkdir(workspace);
  try {
    return await fn(workspace);
  } finally {
    await rm(container, { recursive: true, force: true });
  }
}

/** A workspace in which every governed check has real inputs to judge. */
async function populateGovernedWorkspace(workspace: string): Promise<void> {
  await mkdir(join(workspace, "src"), { recursive: true });
  await writeFile(join(workspace, "src", "index.ts"), "export const value = 1;\n", "utf8");
  await mkdir(join(workspace, "benchmarks", "corpus", "tier-1"), { recursive: true });
  await writeFile(
    join(workspace, "benchmarks", "corpus", "tier-1", "pinned.json"),
    JSON.stringify({ name: "pinned", revision: "1.0.0" }),
    "utf8",
  );
  await writeFile(join(workspace, "benchmarks", ".gitignore"), ".cache/\n", "utf8");
  await cp(join(PACKAGE_ROOT, "benchmarks", "fixtures"), join(workspace, "benchmarks", "fixtures"), { recursive: true });
}

function runAuditCli(args: readonly string[]): { readonly code: number | null; readonly stdout: string; readonly stderr: string } {
  const result = spawnSync("bun", [BENCHMARK_CLI, "audit", ...args], {
    cwd: PACKAGE_ROOT,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    timeout: AUDIT_TIMEOUT_MS,
    windowsHide: true,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function runBenchmarkSelfAudit(baseDir: string): BenchmarkAuditReport {
  const result = spawnSync("bun", ["-e", AUDIT_DRIVER, AUDIT_MODULE, baseDir], {
    cwd: PACKAGE_ROOT,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    timeout: AUDIT_TIMEOUT_MS,
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`runBenchmarkSelfAudit did not return a report (exit ${result.status}): ${result.stderr}`);
  }
  return JSON.parse(result.stdout) as BenchmarkAuditReport;
}

function passedIds(report: BenchmarkAuditReport): string[] {
  return report.checks.filter((c) => c.passed).map((c) => c.id);
}

describe("F-010: benchmark self-audit cannot pass checks that did no work", () => {
  it("fails every input-dependent check, with NO_GO, when the workspace has no inputs to judge", async () => {
    await withWorkspace(async (workspace) => {
      // Empty but present directories: nothing to scan, no corpus, no fixture, no .gitignore.
      await mkdir(join(workspace, "src"));
      await mkdir(join(workspace, "benchmarks", "corpus"), { recursive: true });

      const report = runBenchmarkSelfAudit(workspace);

      expect(report.verdict).toBe("NO_GO");
      expect(report.passedChecks).toBe(SELF_CONTAINED_CHECK_IDS.length);
      expect(report.failedChecks).toBe(report.totalChecks - SELF_CONTAINED_CHECK_IDS.length);
      expect(report.checks.map((c) => c.id)).toEqual(GOVERNED_CHECK_IDS);
      expect(passedIds(report)).toEqual(SELF_CONTAINED_CHECK_IDS);
      for (const check of report.checks) {
        expect(check.evidence.length).toBeGreaterThan(0);
      }
      expect(report.findings.some((f) => f.severity === "CRITICAL")).toBe(true);
    });
  }, AUDIT_TIMEOUT_MS);

  it("reports unrunnable checks as failures instead of throwing when workspace directories are missing", async () => {
    await withWorkspace(async (workspace) => {
      const report = runBenchmarkSelfAudit(workspace);

      expect(report.verdict).toBe("NO_GO");
      expect(report.totalChecks).toBe(GOVERNED_CHECK_IDS.length);
      expect(passedIds(report)).toEqual(SELF_CONTAINED_CHECK_IDS);
    });
  }, AUDIT_TIMEOUT_MS);

  it("passes every governed check on the pinned checked-in fixture (control)", async () => {
    await withWorkspace(async (workspace) => {
      await populateGovernedWorkspace(workspace);

      const report = runBenchmarkSelfAudit(workspace);

      expect(report.findings).toEqual([]);
      expect(report.verdict).toBe("PASS");
      expect(report.checks.map((c) => c.id)).toEqual(GOVERNED_CHECK_IDS);
      expect(passedIds(report)).toEqual(GOVERNED_CHECK_IDS);
      expect(report.passedChecks).toBe(GOVERNED_CHECK_IDS.length);
      expect(report.failedChecks).toBe(0);
    });
  }, AUDIT_TIMEOUT_MS);

  it("fails only the fixture-backed checks when the fixture no longer matches its pin", async () => {
    await withWorkspace(async (workspace) => {
      await populateGovernedWorkspace(workspace);
      await appendFile(
        join(workspace, "benchmarks", "fixtures", "governance-audit", "src", "math.js"),
        "\nexport function drift() {\n  return 0;\n}\n",
        "utf8",
      );

      const report = runBenchmarkSelfAudit(workspace);

      expect(report.verdict).toBe("NO_GO");
      expect(passedIds(report)).toEqual(GOVERNED_CHECK_IDS.filter((id) => !FIXTURE_CHECK_IDS.includes(id)));
      for (const id of FIXTURE_CHECK_IDS) {
        const check = report.checks.find((c) => c.id === id);
        expect(check?.passed).toBe(false);
        expect(check?.evidence).toContain("src/math.js");
      }
    });
  }, AUDIT_TIMEOUT_MS);
});

describe("F-010: benchmark audit CLI exit code reflects the governed result", () => {
  it("exits non-zero when checks cannot run", async () => {
    await withWorkspace(async (workspace) => {
      const result = runAuditCli(["--root", workspace, "--json"]);

      expect(result.code).not.toBe(0);
      const report = JSON.parse(result.stdout) as { verdict: string; passedChecks: number; totalChecks: number };
      expect(report.verdict).toBe("NO_GO");
      expect(report.passedChecks).toBe(SELF_CONTAINED_CHECK_IDS.length);
      expect(report.totalChecks).toBe(GOVERNED_CHECK_IDS.length);
    });
  }, AUDIT_TIMEOUT_MS);

  it("exits non-zero when a check fails with a non-CRITICAL finding", async () => {
    await withWorkspace(async (workspace) => {
      await populateGovernedWorkspace(workspace);
      // Only the Git hygiene check (HIGH severity) can fail: nothing excludes .cache.
      await writeFile(join(workspace, "benchmarks", ".gitignore"), "results/\n", "utf8");

      const result = runAuditCli(["--root", workspace, "--json"]);

      expect(result.code).not.toBe(0);
      const report = JSON.parse(result.stdout) as BenchmarkAuditReport;
      expect(report.verdict).toBe("PASS_WITH_CONDITIONS");
      expect(passedIds(report)).toEqual(GOVERNED_CHECK_IDS.filter((id) => id !== "git-hygiene"));
    });
  }, AUDIT_TIMEOUT_MS);

  it("exits zero only when every governed check passed, using only checked-in inputs", () => {
    const result = runAuditCli([]);
    const counts = /Passed: (\d+)\/(\d+) checks/.exec(result.stdout);
    if (counts === null) {
      throw new Error(`audit printed no "Passed: X/Y checks" line (exit ${result.code}):\n${result.stdout}\n${result.stderr}`);
    }
    const passed = Number(counts[1]);
    const total = Number(counts[2]);
    if (result.code === 0) {
      expect(passed).toBe(total);
    }
    expect({ code: result.code, passed, total }).toEqual({
      code: 0,
      passed: GOVERNED_CHECK_IDS.length,
      total: GOVERNED_CHECK_IDS.length,
    });
  }, AUDIT_TIMEOUT_MS);
});
