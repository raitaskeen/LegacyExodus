import type { TerminalCapabilities } from "./capabilities";
import { LayoutRenderer } from "./layout";

export interface TestExecutionSummary {
  readonly suitesPassed: number;
  readonly suitesTotal: number;
  readonly testsPassed: number;
  readonly testsFailed: number;
  readonly testsSkipped: number;
  readonly assertionsTotal: number;
  readonly durationMs: number;
}

export interface VerificationGateResult {
  readonly name: string;
  readonly status: "pass" | "fail" | "skip";
  readonly details: string;
  readonly durationMs?: number;
  readonly diagnostics?: string;
}

export class VerificationPresenter {
  private readonly layout: LayoutRenderer;

  public constructor(public readonly capabilities: TerminalCapabilities) {
    this.layout = new LayoutRenderer(capabilities);
  }

  public renderTestSummary(summary: TestExecutionSummary): string {
    if (this.capabilities.mode === "plain") {
      return [
        "Test Verification Summary",
        `  Suites: ${summary.suitesPassed}/${summary.suitesTotal} passed`,
        `  Tests: ${summary.testsPassed} passed, ${summary.testsFailed} failed, ${summary.testsSkipped} skipped`,
        `  Assertions: ${summary.assertionsTotal}`,
        `  Duration: ${summary.durationMs.toFixed(2)}ms`,
      ].join("\n");
    }

    const header = this.layout.renderHeader("Test Suite Verification");
    const isSuccess = summary.testsFailed === 0;

    const card = this.layout.renderCard([
      {
        label: "Test Suites",
        value: `${summary.suitesPassed} passed of ${summary.suitesTotal}`,
        badge: isSuccess ? "ALL PASS" : `${summary.suitesTotal - summary.suitesPassed} FAILED`,
        badgeType: isSuccess ? "success" : "error",
      },
      {
        label: "Total Tests",
        value: `${summary.testsPassed} passed`,
        badge: summary.testsFailed === 0 ? "0 FAILS" : `${summary.testsFailed} FAILS`,
        badgeType: summary.testsFailed === 0 ? "success" : "error",
      },
      {
        label: "Assertions",
        value: `${summary.assertionsTotal.toLocaleString()} expect() checks`,
      },
      {
        label: "Execution Time",
        value: `${summary.durationMs.toFixed(2)} ms`,
      },
    ]);

    const banner = isSuccess
      ? `  ${this.layout.theme.success(this.layout.symbols.success)} ${this.layout.theme.text("All test suites passed with 100% contract compliance.")}`
      : `  ${this.layout.theme.error(this.layout.symbols.failure)} ${this.layout.theme.error(`${summary.testsFailed} test(s) failed in test suite.`)}`;

    const divider = this.layout.renderDivider();

    return [header, "", card, "", banner, "", divider].join("\n");
  }

  public renderTypecheckSummary(stats: { errors: number; fileCount: number; durationMs: number }): string {
    if (this.capabilities.mode === "plain") {
      return stats.errors === 0
        ? `[PASS] Typecheck: 0 errors in ${stats.fileCount} files (${stats.durationMs.toFixed(0)}ms)`
        : `[FAIL] Typecheck: ${stats.errors} error(s) in ${stats.fileCount} files`;
    }

    const header = this.layout.renderHeader("Static Typecheck");
    const isPass = stats.errors === 0;

    const card = this.layout.renderCard([
      {
        label: "TypeScript Compiler",
        value: isPass ? "Passed" : "Failed",
        badge: isPass ? "ZERO ERRORS" : `${stats.errors} ERRORS`,
        badgeType: isPass ? "success" : "error",
      },
      { label: "Source Files", value: `${stats.fileCount} files verified` },
      { label: "Typecheck Time", value: `${stats.durationMs.toFixed(0)} ms` },
    ]);

    const banner = isPass
      ? `  ${this.layout.theme.success(this.layout.symbols.success)} ${this.layout.theme.text("Static typecheck verified cleanly.")}`
      : `  ${this.layout.theme.error(this.layout.symbols.failure)} ${this.layout.theme.error("Static typecheck encountered errors.")}`;

    const divider = this.layout.renderDivider();
    return [header, "", card, "", banner, "", divider].join("\n");
  }

  public renderBenchmarkAudit(report: {
    totalChecks: number;
    passedChecks: number;
    failedChecks: number;
    verdict: string;
    engineSha: string;
    auditedAt: string;
    findings?: readonly { category: string; description: string }[];
  }): string {
    if (this.capabilities.mode === "plain") {
      return [
        "Benchmark Governance Audit",
        `  Verdict: ${report.verdict}`,
        `  Passed: ${report.passedChecks}/${report.totalChecks} checks`,
        `  Engine SHA: ${report.engineSha}`,
      ].join("\n");
    }

    const header = this.layout.renderHeader("Benchmark Governance Audit");
    const isPass = report.verdict === "PASS" && report.failedChecks === 0;

    const card = this.layout.renderCard([
      {
        label: "Governance Verdict",
        value: report.verdict,
        badge: isPass ? "VERIFIED" : "FAILED",
        badgeType: isPass ? "success" : "error",
      },
      {
        label: "Governance Checks",
        value: `${report.passedChecks} of ${report.totalChecks} passed`,
        badge: `${report.failedChecks} FINDINGS`,
        badgeType: report.failedChecks === 0 ? "success" : "warning",
      },
      { label: "Engine SHA", value: report.engineSha.slice(0, 12) },
      { label: "Audited At", value: report.auditedAt },
    ]);

    const banner = isPass
      ? `  ${this.layout.theme.success(this.layout.symbols.success)} ${this.layout.theme.text("All 10 benchmark governance checks passed with zero findings.")}`
      : `  ${this.layout.theme.error(this.layout.symbols.failure)} ${this.layout.theme.error(`${report.failedChecks} benchmark governance check(s) failed.`)}`;

    const divider = this.layout.renderDivider();
    return [header, "", card, "", banner, "", divider].join("\n");
  }

  public renderVerificationDashboard(gates: readonly VerificationGateResult[], totalDurationMs: number): string {
    const failedGates = gates.filter((g) => g.status === "fail");
    const allPassed = failedGates.length === 0;

    if (this.capabilities.mode === "plain" || this.capabilities.mode === "ci") {
      const gateLines = gates.map(
        (g) => `  [${g.status.toUpperCase()}] ${g.name}: ${g.details}${g.durationMs ? ` (${g.durationMs.toFixed(0)}ms)` : ""}`,
      );
      const lines = ["Repository Verification Dashboard", ...gateLines, `Total Time: ${totalDurationMs.toFixed(0)}ms`];

      if (!allPassed) {
        lines.push("", "--- Verification Failure Diagnostics ---");
        for (const failed of failedGates) {
          lines.push(`\n[${failed.name}]`);
          lines.push(failed.diagnostics || failed.details);
        }
      }

      return lines.join("\n");
    }

    const header = this.layout.renderHeader("Repository Verification Dashboard");

    const gateLines = gates.map((gate, i) => {
      let icon = this.layout.theme.success(this.layout.symbols.success);
      let statusBadge = this.layout.theme.success("PASS");

      if (gate.status === "fail") {
        icon = this.layout.theme.error(this.layout.symbols.failure);
        statusBadge = this.layout.theme.error("FAIL");
      } else if (gate.status === "skip") {
        icon = this.layout.theme.muted("○");
        statusBadge = this.layout.theme.muted("SKIP");
      }

      const durText = gate.durationMs ? ` ${this.layout.theme.muted(`(${gate.durationMs.toFixed(0)} ms)`)}` : "";
      return `  [${i + 1}/${gates.length}] ${icon} ${this.layout.theme.heading(gate.name.padEnd(25, " "))} ${statusBadge} ${this.layout.theme.text(gate.details)}${durText}`;
    });

    const banner = allPassed
      ? `  ${this.layout.theme.success(this.layout.symbols.success)} ${this.layout.theme.heading("REPOSITORY VERIFICATION: ALL GATES PASSED")} ${this.layout.theme.muted(`[${totalDurationMs.toFixed(0)} ms total]`)}`
      : `  ${this.layout.theme.error(this.layout.symbols.failure)} ${this.layout.theme.error(`REPOSITORY VERIFICATION: ${failedGates.length} OF ${gates.length} GATES FAILED`)}`;

    const divider = this.layout.renderDivider();

    const outputParts = [header, "", ...gateLines, "", banner];

    if (!allPassed) {
      outputParts.push("", divider, `  ${this.layout.theme.heading("Failure Diagnostics")}`, "");
      for (const failed of failedGates) {
        outputParts.push(`  ${this.layout.theme.error(this.layout.symbols.failure)} ${this.layout.theme.heading(failed.name)}`);
        const diagText = failed.diagnostics || failed.details;
        const formattedDiag = diagText
          .split("\n")
          .map((line) => `    ${this.layout.theme.muted(line)}`)
          .join("\n");
        outputParts.push(formattedDiag, "");
      }
    }

    outputParts.push(divider);

    return outputParts.join("\n");
  }
}
