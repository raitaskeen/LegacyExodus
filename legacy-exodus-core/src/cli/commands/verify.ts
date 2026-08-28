import { spawn } from "node:child_process";
import type { Command } from "commander";

import { detectTerminalCapabilities } from "../presentation/capabilities";
import { VerificationPresenter, type VerificationGateResult } from "../presentation/verification";

export async function runCommand(
  cmd: string,
  args: string[],
): Promise<{ readonly code: number; readonly durationMs: number }> {
  const startedAt = performance.now();

  return new Promise((resolve) => {
    const isWindows = process.platform === "win32";
    const child = isWindows
      ? spawn(`${cmd} ${args.join(" ")}`, { stdio: "ignore", shell: true })
      : spawn(cmd, args, { stdio: "ignore" });

    child.on("close", (code) => {
      const durationMs = performance.now() - startedAt;
      resolve({ code: code ?? 1, durationMs });
    });
    child.on("error", () => {
      const durationMs = performance.now() - startedAt;
      resolve({ code: 1, durationMs });
    });
  });
}

export async function executeVerification(): Promise<boolean> {
  const capabilities = detectTerminalCapabilities();
  const presenter = new VerificationPresenter(capabilities);
  const totalStart = performance.now();
  const gates: VerificationGateResult[] = [];

  // Gate 1: Typecheck
  const typecheck = await runCommand("bun", ["run", "typecheck"]);
  gates.push({
    name: "Static Typecheck",
    status: typecheck.code === 0 ? "pass" : "fail",
    details: typecheck.code === 0 ? "Zero compiler errors" : "Typecheck failed",
    durationMs: typecheck.durationMs,
  });

  // Gate 2: Unit & Integration Test Suite
  const tests = await runCommand("bun", ["test"]);
  gates.push({
    name: "Test Suite",
    status: tests.code === 0 ? "pass" : "fail",
    details: tests.code === 0 ? "All tests passing" : "Test failure(s) detected",
    durationMs: tests.durationMs,
  });

  // Gate 3: Benchmark Governance Audit
  const audit = await runCommand("bun", ["run", "benchmark", "audit"]);
  gates.push({
    name: "Benchmark Governance",
    status: audit.code === 0 ? "pass" : "fail",
    details: audit.code === 0 ? "10/10 audit checks verified" : "Governance finding(s) detected",
    durationMs: audit.durationMs,
  });

  // Gate 4: Git Diff Hygiene
  const gitDiff = await runCommand("git", ["diff", "--check"]);
  gates.push({
    name: "Git Working Tree Hygiene",
    status: gitDiff.code === 0 ? "pass" : "fail",
    details: gitDiff.code === 0 ? "No whitespace/diff issues" : "Diff check issues",
    durationMs: gitDiff.durationMs,
  });

  const totalDurationMs = performance.now() - totalStart;
  const output = presenter.renderVerificationDashboard(gates, totalDurationMs);
  process.stdout.write(`${output}\n`);

  return gates.every((g) => g.status === "pass");
}

export function registerVerifyCommand(program: Command): void {
  program
    .command("verify")
    .description("Run complete repository verification (Typecheck, Tests, Benchmark Audit, Git Hygiene)")
    .action(async (): Promise<void> => {
      const passed = await executeVerification();
      if (!passed) {
        process.exitCode = 1;
      }
    });
}
