/**
 * F-010 — `verify` must report the benchmark audit's real result.
 *
 * Runs the real `verify` command in a scratch project whose `typecheck`, `test`
 * and `benchmark` scripts are stubs, so the Benchmark Governance gate sees a
 * controlled audit result without recursively running the real suite.
 */

import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI_ENTRY = resolve(import.meta.dir, "../../../src/cli/index.ts");
const VERIFY_TIMEOUT_MS = 60_000;

const STUB_SCRIPT = `
import { readFileSync } from "node:fs";
const kind = process.argv[2];
if (kind === "benchmark") {
  process.stdout.write(readFileSync("audit-stdout.txt", "utf8"));
  process.exit(Number(readFileSync("audit-exit.txt", "utf8")));
}
if (kind === "test") {
  console.log(" 1 pass\\n 0 fail\\n 1 expect() calls\\nRan 1 tests across 1 file. [1.00ms]");
}
`;

interface StubFinding {
  readonly category: string;
  readonly severity: string;
  readonly description: string;
  readonly evidence: string;
}

function auditReport(
  passed: number,
  total: number,
  verdict: "PASS" | "PASS_WITH_CONDITIONS" | "NO_GO",
  findings: readonly StubFinding[] = [],
): Record<string, unknown> {
  return {
    auditedAt: "2026-01-01T00:00:00.000Z",
    engineSha: "0000000000000000000000000000000000000000",
    totalChecks: total,
    passedChecks: passed,
    failedChecks: total - passed,
    checks: Array.from({ length: total }, (_, i) => ({
      id: `check-${i + 1}`,
      name: `Check ${i + 1}`,
      passed: i < passed,
      evidence: "stub evidence",
    })),
    findings,
    verdict,
  };
}

async function runVerifyWithAudit(
  auditStdout: string,
  auditExitCode: number,
): Promise<{ readonly code: number | null; readonly stdout: string; readonly governanceLine: string | undefined }> {
  const project = await mkdtemp(join(tmpdir(), "legacy-exodus-verify-gate-"));
  try {
    await writeFile(
      join(project, "package.json"),
      JSON.stringify({
        name: "verify-gate-stub",
        private: true,
        scripts: {
          typecheck: "bun stub.mjs typecheck",
          test: "bun stub.mjs test",
          benchmark: "bun stub.mjs benchmark",
        },
      }),
      "utf8",
    );
    await writeFile(join(project, "stub.mjs"), STUB_SCRIPT, "utf8");
    await writeFile(join(project, "audit-stdout.txt"), auditStdout, "utf8");
    await writeFile(join(project, "audit-exit.txt"), String(auditExitCode), "utf8");
    spawnSync("git", ["init", "-q"], { cwd: project, windowsHide: true });

    const result = spawnSync("bun", [CLI_ENTRY, "verify"], {
      cwd: project,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
      timeout: VERIFY_TIMEOUT_MS,
      windowsHide: true,
    });
    const governanceLine = result.stdout
      .split(/\r?\n/)
      .find((line) => line.includes("Benchmark Governance:"))
      ?.trim();
    return { code: result.status, stdout: result.stdout, governanceLine };
  } finally {
    await rm(project, { recursive: true, force: true });
  }
}

describe("F-010: verify reports the benchmark audit's real result", () => {
  it("reports the audit's actual check count when every check passed", async () => {
    const result = await runVerifyWithAudit(JSON.stringify(auditReport(8, 8, "PASS")), 0);

    expect(result.governanceLine).toStartWith("[PASS] Benchmark Governance: 8/8 audit checks verified");
    expect(result.code).toBe(0);
  }, VERIFY_TIMEOUT_MS);

  it("fails the gate when the audit reports a failed check, even if the audit exited zero", async () => {
    const result = await runVerifyWithAudit(JSON.stringify(auditReport(7, 8, "PASS_WITH_CONDITIONS")), 0);

    expect(result.governanceLine).toStartWith("[FAIL] Benchmark Governance:");
    expect(result.governanceLine).toContain("7/8");
    expect(result.code).toBe(1);
  }, VERIFY_TIMEOUT_MS);

  it("fails the gate when the audit result cannot be read", async () => {
    const result = await runVerifyWithAudit("Benchmark Governance Audit\n  Verdict: PASS\n", 0);

    expect(result.governanceLine).toStartWith("[FAIL] Benchmark Governance:");
    expect(result.code).toBe(1);
  }, VERIFY_TIMEOUT_MS);

  it("fails the gate when the audit's counts are internally inconsistent", async () => {
    const inflated = { ...auditReport(7, 8, "PASS"), passedChecks: 8, failedChecks: 0 };
    const result = await runVerifyWithAudit(JSON.stringify(inflated), 0);

    expect(result.governanceLine).toStartWith("[FAIL] Benchmark Governance:");
    expect(result.code).toBe(1);
  }, VERIFY_TIMEOUT_MS);

  it("reports the real count and the findings when the audit fails", async () => {
    const findings: StubFinding[] = [
      {
        category: "Determinism",
        severity: "CRITICAL",
        description: "Multi-run determinism verification failed on the governance fixture",
        evidence: "Artifact semantic.json has 2 distinct SHA-256 hashes across 3 runs",
      },
    ];
    const result = await runVerifyWithAudit(JSON.stringify(auditReport(5, 8, "NO_GO", findings)), 1);

    expect(result.governanceLine).toStartWith("[FAIL] Benchmark Governance:");
    expect(result.governanceLine).toContain("5/8");
    expect(result.stdout).toContain("Multi-run determinism verification failed on the governance fixture");
    expect(result.code).toBe(1);
  }, VERIFY_TIMEOUT_MS);
});
