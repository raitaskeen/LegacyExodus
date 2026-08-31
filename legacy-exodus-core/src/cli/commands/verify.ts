import { spawn } from "node:child_process";
import type { Command } from "commander";

import { detectTerminalCapabilities } from "../presentation/capabilities";
import { parseBunTestOutput } from "../presentation/test-runner";
import { VerificationPresenter, type VerificationGateResult } from "../presentation/verification";

export interface CommandResult {
  readonly code: number;
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
}

export function extractDiagnosticSnippet(raw: string, maxLines = 15): string {
  const lines = raw.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length <= maxLines) {
    return lines.join("\n");
  }

  // Look for error / failure markers
  const failIdx = lines.findIndex((l) =>
    l.includes("error TS") ||
    l.includes("(fail)") ||
    l.includes("FAIL") ||
    l.includes("Error:") ||
    l.includes("Expected:") ||
    l.includes("fatal:")
  );

  if (failIdx !== -1) {
    const start = Math.max(0, failIdx - 1);
    return lines.slice(start, start + maxLines).join("\n");
  }

  // Fallback: take bounded tail
  return lines.slice(-maxLines).join("\n");
}

export async function runCommand(
  cmd: string,
  args: string[],
): Promise<CommandResult> {
  const startedAt = performance.now();

  return new Promise((resolve) => {
    const isWindows = process.platform === "win32";
    const child = isWindows
      ? spawn(`${cmd} ${args.join(" ")}`, { stdio: "pipe", shell: true })
      : spawn(cmd, args, { stdio: "pipe" });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("close", (code) => {
      const durationMs = performance.now() - startedAt;
      resolve({ code: code ?? 1, durationMs, stdout, stderr });
    });
    child.on("error", (err) => {
      const durationMs = performance.now() - startedAt;
      resolve({ code: 1, durationMs, stdout, stderr: `${stderr}\n${err.message}` });
    });
  });
}

export async function executeVerification(options: { readonly theme?: string } = {}): Promise<boolean> {
  const capabilities = detectTerminalCapabilities({ theme: options.theme });
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
    diagnostics: typecheck.code !== 0 ? extractDiagnosticSnippet(typecheck.stdout || typecheck.stderr) : undefined,
  });

  // Gate 2: Unit & Integration Test Suite
  const tests = await runCommand("bun", ["run", "test"]);
  const parsedTests = parseBunTestOutput(`${tests.stdout}\n${tests.stderr}`);
  const testDetails = tests.code === 0
    ? (parsedTests.testsPassed > 0
      ? `All ${parsedTests.testsPassed} tests passing across ${parsedTests.suitesTotal} files`
      : "All tests passing")
    : `${parsedTests.testsFailed} test(s) failed in suite`;

  gates.push({
    name: "Test Suite",
    status: tests.code === 0 ? "pass" : "fail",
    details: testDetails,
    durationMs: tests.durationMs,
    diagnostics: tests.code !== 0 ? extractDiagnosticSnippet(tests.stdout || tests.stderr) : undefined,
  });

  // Gate 3: Benchmark Governance Audit
  const audit = await runCommand("bun", ["run", "benchmark", "audit"]);
  gates.push({
    name: "Benchmark Governance",
    status: audit.code === 0 ? "pass" : "fail",
    details: audit.code === 0 ? "10/10 audit checks verified" : "Governance finding(s) detected",
    durationMs: audit.durationMs,
    diagnostics: audit.code !== 0 ? extractDiagnosticSnippet(audit.stdout || audit.stderr) : undefined,
  });

  // Gate 4: Git Diff Hygiene
  const gitDiff = await runCommand("git", ["diff", "--check"]);
  gates.push({
    name: "Git Working Tree Hygiene",
    status: gitDiff.code === 0 ? "pass" : "fail",
    details: gitDiff.code === 0 ? "No whitespace/diff issues" : "Diff check issues",
    durationMs: gitDiff.durationMs,
    diagnostics: gitDiff.code !== 0 ? extractDiagnosticSnippet(gitDiff.stdout || gitDiff.stderr) : undefined,
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
    .option("--theme <name>", "Visual theme (classic, aurora, mono)")
    .action(async (options: { readonly theme?: string }): Promise<void> => {
      const passed = await executeVerification({ theme: options?.theme });
      if (!passed) {
        process.exitCode = 1;
      }
    });
}
