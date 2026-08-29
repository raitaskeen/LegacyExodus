import type { TerminalCapabilities } from "./capabilities";
import { LayoutRenderer } from "./layout";
import { stripAnsi } from "./theme";

export interface TestCategorySummary {
  readonly name: string;
  readonly passed: number;
  readonly failed: number;
}

export interface CoverageSummary {
  readonly statementsPct?: number;
  readonly functionsPct?: number;
  readonly linesPct?: number;
  readonly isHealthy: boolean;
}

export interface TestFailureDetail {
  readonly suite: string;
  readonly test: string;
  readonly expected?: string;
  readonly received?: string;
  readonly location?: string;
  readonly message?: string;
}

export interface FocusedTestSummary {
  readonly target: string;
  readonly testsPassed: number;
  readonly testsFailed: number;
  readonly assertionsTotal: number;
  readonly durationMs: number;
  readonly failureDetails?: readonly TestFailureDetail[];
}

export interface ParsedBunTestResult {
  readonly isFocused: boolean;
  readonly target?: string;
  readonly suitesPassed: number;
  readonly suitesTotal: number;
  readonly testsPassed: number;
  readonly testsFailed: number;
  readonly testsSkipped: number;
  readonly assertionsTotal: number;
  readonly durationMs: number;
  readonly categories: readonly TestCategorySummary[];
  readonly coverage?: CoverageSummary;
  readonly failures: readonly TestFailureDetail[];
}

export function mapFileToCategory(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.includes("/contracts/")) return "Core Contracts";
  if (normalized.includes("/discovery/")) return "Discovery";
  if (normalized.includes("/parser/")) return "Parser";
  if (normalized.includes("/symbols/")) return "Symbols";
  if (normalized.includes("/graph/") || normalized.includes("/semantic/")) return "Graph & Semantic";
  if (normalized.includes("/flow/")) return "Flow Analysis";
  if (normalized.includes("/storage/")) return "Storage & Persistence";
  if (normalized.includes("/runtime/") || normalized.includes("/orchestration/")) return "Runtime & Orchestration";
  if (normalized.includes("/projections/")) return "Projections";
  if (normalized.includes("/governance/")) return "Governance & Fidelity";
  if (normalized.includes("/cli/")) return "CLI Presentation";
  if (normalized.includes("/integration/")) return "Integration Scenarios";
  return "General Suites";
}

export function parseBunTestOutput(raw: string, targetHint?: string): ParsedBunTestResult {
  const clean = stripAnsi(raw);
  const lines = clean.split(/\r?\n/);

  const categoryMap = new Map<string, { passed: number; failed: number }>();
  let currentFile = "";
  const failures: TestFailureDetail[] = [];
  let currentFailSuite = "";
  let currentFailTest = "";
  let currentExpected = "";
  let currentReceived = "";
  let currentLocation = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? "";

    // Check for test file header (e.g. tests/unit/foo.test.ts:)
    if (line.match(/^tests[\\/].*\.test\.ts:$/i)) {
      currentFile = line.replace(/:$/, "");
      continue;
    }

    // Check pass/fail test items
    if (line.startsWith("(pass)")) {
      const cat = currentFile ? mapFileToCategory(currentFile) : "General Suites";
      const existing = categoryMap.get(cat) ?? { passed: 0, failed: 0 };
      existing.passed++;
      categoryMap.set(cat, existing);
    } else if (line.startsWith("(fail)")) {
      const cat = currentFile ? mapFileToCategory(currentFile) : "General Suites";
      const existing = categoryMap.get(cat) ?? { passed: 0, failed: 0 };
      existing.failed++;
      categoryMap.set(cat, existing);

      // Extract test name
      const match = line.match(/^\(fail\)\s+(.*?)(\s+\[.*\])?$/);
      if (match) {
        currentFailSuite = currentFile;
        currentFailTest = match[1] ?? "unnamed test";
      }
    }

    // Parse Expected / Received / Location
    if (line.startsWith("Expected:") || line.startsWith("Expected to contain:")) {
      currentExpected = line.replace(/^Expected(\s+to\s+contain)?:\s*/, "");
    }
    if (line.startsWith("Received:")) {
      currentReceived = line.replace(/^Received:\s*/, "");
    }
    if (line.includes("at ") && line.includes(".test.ts:")) {
      const locMatch = line.match(/at\s+.*?\((.*?)\)/) || line.match(/at\s+(.*?)$/);
      if (locMatch) {
        currentLocation = locMatch[1] ?? "";
        if (currentFailTest) {
          failures.push({
            suite: currentFailSuite,
            test: currentFailTest,
            expected: currentExpected || undefined,
            received: currentReceived || undefined,
            location: currentLocation || undefined,
          });
          currentFailSuite = "";
          currentFailTest = "";
          currentExpected = "";
          currentReceived = "";
          currentLocation = "";
        }
      }
    }
  }

  // Parse summary numbers
  let testsPassed = 0;
  let testsFailed = 0;
  let testsSkipped = 0;
  let assertionsTotal = 0;
  let durationMs = 0;
  let suitesTotal = 0;

  for (const line of lines) {
    const passMatch = line.match(/(\d+)\s+pass/);
    if (passMatch) testsPassed = parseInt(passMatch[1] ?? "0", 10);

    const failMatch = line.match(/(\d+)\s+fail/);
    if (failMatch) testsFailed = parseInt(failMatch[1] ?? "0", 10);

    const skipMatch = line.match(/(\d+)\s+skip/);
    if (skipMatch) testsSkipped = parseInt(skipMatch[1] ?? "0", 10);

    const expectMatch = line.match(/(\d[\d,]*)\s+expect\(\)\s+calls/);
    if (expectMatch) assertionsTotal = parseInt(expectMatch[1]?.replace(/,/g, "") ?? "0", 10);

    const ranMatch = line.match(/Ran\s+(\d+)\s+tests\s+across\s+(\d+)\s+files?\.?\s+\[([0-9.]+)(ms|s)\]/i);
    if (ranMatch) {
      suitesTotal = parseInt(ranMatch[2] ?? "1", 10);
      const num = parseFloat(ranMatch[3] ?? "0");
      const unit = ranMatch[4];
      durationMs = unit === "s" ? num * 1000 : num;
    }
  }

  // Parse coverage if present
  let coverage: CoverageSummary | undefined;
  for (const line of lines) {
    if (line.startsWith("All files") || line.includes("All files")) {
      const parts = line.split("|").map((p) => p.trim());
      if (parts.length >= 3) {
        const funcs = parseFloat(parts[1] ?? "0");
        const lns = parseFloat(parts[2] ?? "0");
        coverage = {
          functionsPct: isNaN(funcs) ? undefined : funcs,
          linesPct: isNaN(lns) ? undefined : lns,
          statementsPct: isNaN(lns) ? undefined : lns,
          isHealthy: (isNaN(lns) ? 100 : lns) >= 80,
        };
      }
    }
  }

  const isFocused = Boolean(targetHint) || suitesTotal === 1;
  const target = targetHint || (suitesTotal === 1 ? currentFile : undefined);

  const categories: TestCategorySummary[] = Array.from(categoryMap.entries()).map(([name, counts]) => ({
    name,
    passed: counts.passed,
    failed: counts.failed,
  }));

  const suitesPassed = testsFailed === 0 ? suitesTotal : Math.max(0, suitesTotal - 1);

  return {
    isFocused,
    target,
    suitesPassed,
    suitesTotal,
    testsPassed,
    testsFailed,
    testsSkipped,
    assertionsTotal,
    durationMs,
    categories,
    coverage,
    failures,
  };
}

export class TestPresenter {
  private readonly layout: LayoutRenderer;

  public constructor(public readonly capabilities: TerminalCapabilities) {
    this.layout = new LayoutRenderer(capabilities);
  }

  public renderFullTestVerification(result: ParsedBunTestResult): string {
    if (this.capabilities.mode === "plain" || this.capabilities.mode === "ci") {
      const catLines = result.categories.map(
        (c) => `  ${c.name.padEnd(28, " ")} ${c.failed === 0 ? `[PASS] ${c.passed} passed` : `[FAIL] ${c.failed} failed, ${c.passed} passed`}`,
      );
      const summaryLines = [
        "Test Verification Summary",
        ...catLines,
        `  Test Suites: ${result.suitesPassed}/${result.suitesTotal} passed`,
        `  Tests: ${result.testsPassed} passed, ${result.testsFailed} failed`,
        `  Assertions: ${result.assertionsTotal}`,
        `  Duration: ${(result.durationMs / 1000).toFixed(2)}s`,
        result.testsFailed === 0 ? "[PASS] ALL TESTS PASSED" : "[FAIL] TEST SUITE FAILED",
      ];
      return summaryLines.join("\n");
    }

    const header = this.layout.renderHeader("Test Verification");

    // Category tree breakdown
    const categoryRows = result.categories.map((c) => {
      const isPass = c.failed === 0;
      const glyph = isPass
        ? this.layout.theme.success(this.layout.symbols.success)
        : this.layout.theme.error(this.layout.symbols.failure);
      const nameStyled = this.layout.theme.text(c.name.padEnd(30, " "));
      const countStyled = isPass
        ? this.layout.theme.muted(`${c.passed} passed`)
        : this.layout.theme.error(`${c.failed} failed, ${c.passed} passed`);
      return `  ${nameStyled} ${glyph} ${countStyled}`;
    });

    // Summary Card
    const isSuccess = result.testsFailed === 0;
    const summaryCard = this.layout.renderCard([
      {
        label: "Test Suites",
        value: `${result.suitesPassed} passed of ${result.suitesTotal}`,
        badge: isSuccess ? "ALL PASS" : `${result.suitesTotal - result.suitesPassed} FAILED`,
        badgeType: isSuccess ? "success" : "error",
      },
      {
        label: "Total Tests",
        value: `${result.testsPassed} passed`,
        badge: isSuccess ? "0 FAILS" : `${result.testsFailed} FAILS`,
        badgeType: isSuccess ? "success" : "error",
      },
      {
        label: "Failures",
        value: result.testsFailed,
        badge: isSuccess ? "ZERO" : `${result.testsFailed} FAILED`,
        badgeType: isSuccess ? "success" : "error",
      },
      {
        label: "Assertions",
        value: `${result.assertionsTotal.toLocaleString()} expect() checks`,
      },
      {
        label: "Duration",
        value: result.durationMs >= 1000 ? `${(result.durationMs / 1000).toFixed(2)}s` : `${result.durationMs.toFixed(0)}ms`,
      },
    ]);

    // Optional Coverage Card
    let coverageBlock = "";
    if (result.coverage) {
      const covItems = [];
      if (result.coverage.statementsPct !== undefined) {
        covItems.push({ label: "Statements", value: `${result.coverage.statementsPct.toFixed(1)}%` });
      }
      if (result.coverage.functionsPct !== undefined) {
        covItems.push({ label: "Functions", value: `${result.coverage.functionsPct.toFixed(1)}%` });
      }
      if (result.coverage.linesPct !== undefined) {
        covItems.push({ label: "Lines", value: `${result.coverage.linesPct.toFixed(1)}%` });
      }
      covItems.push({
        label: "Coverage Status",
        value: result.coverage.isHealthy ? "Healthy" : "Below Threshold",
        badge: result.coverage.isHealthy ? "PASS" : "WARN",
        badgeType: (result.coverage.isHealthy ? "success" : "warning") as "success" | "warning",
      });
      coverageBlock = `\n${this.layout.renderSection("Coverage", this.layout.renderCard(covItems))}\n`;
    }

    // Optional Failure Details Card
    let failureBlock = "";
    if (result.failures.length > 0) {
      const failCards = result.failures.map((f) => {
        return this.layout.renderCard([
          { label: "Suite", value: f.suite || "unknown" },
          { label: "Test", value: f.test },
          ...(f.expected ? [{ label: "Expected", value: f.expected }] : []),
          ...(f.received ? [{ label: "Received", value: f.received }] : []),
          ...(f.location ? [{ label: "Location", value: f.location }] : []),
        ]);
      });
      failureBlock = `\n${this.layout.theme.error("  FAILED TEST")}\n\n${failCards.join("\n\n")}\n`;
    }

    const banner = isSuccess
      ? `  ${this.layout.theme.success(this.layout.symbols.success)} ${this.layout.theme.text("ALL TESTS PASSED")}`
      : `  ${this.layout.theme.error(this.layout.symbols.failure)} ${this.layout.theme.error(`TEST SUITE FAILED · ${result.testsPassed} passed · ${result.testsFailed} failed`)}`;

    const divider = this.layout.renderDivider();

    return [
      header,
      "",
      ...(categoryRows.length > 0 ? [categoryRows.join("\n"), "", divider, ""] : []),
      summaryCard,
      coverageBlock,
      failureBlock,
      divider,
      "",
      banner,
    ].filter((s) => s.length > 0).join("\n");
  }

  public renderFocusedTest(summary: FocusedTestSummary): string {
    if (this.capabilities.mode === "plain" || this.capabilities.mode === "ci") {
      return [
        "Focused Test Summary",
        `  Target: ${summary.target}`,
        `  Passed: ${summary.testsPassed}`,
        `  Failed: ${summary.testsFailed}`,
        `  Assertions: ${summary.assertionsTotal}`,
        `  Duration: ${summary.durationMs.toFixed(0)}ms`,
        summary.testsFailed === 0 ? "[PASS] FOCUSED TEST PASSED" : "[FAIL] FOCUSED TEST FAILED",
      ].join("\n");
    }

    const header = this.layout.renderHeader("Focused Test");
    const isSuccess = summary.testsFailed === 0;

    const card = this.layout.renderCard([
      { label: "Target", value: this.layout.truncatePath(summary.target) },
      {
        label: "Tests",
        value: `${summary.testsPassed} passed`,
        badge: isSuccess ? "ALL PASS" : `${summary.testsFailed} FAILED`,
        badgeType: isSuccess ? "success" : "error",
      },
      {
        label: "Assertions",
        value: `${summary.assertionsTotal} expect() checks`,
      },
      {
        label: "Duration",
        value: `${summary.durationMs.toFixed(0)} ms`,
      },
    ]);

    let failureBlock = "";
    if (summary.failureDetails && summary.failureDetails.length > 0) {
      const failCards = summary.failureDetails.map((f) => {
        return this.layout.renderCard([
          { label: "Suite", value: f.suite || summary.target },
          { label: "Test", value: f.test },
          ...(f.expected ? [{ label: "Expected", value: f.expected }] : []),
          ...(f.received ? [{ label: "Received", value: f.received }] : []),
          ...(f.location ? [{ label: "Location", value: f.location }] : []),
        ]);
      });
      failureBlock = `\n${this.layout.theme.error("  FAILED TEST")}\n\n${failCards.join("\n\n")}\n`;
    }

    const banner = isSuccess
      ? `  ${this.layout.theme.success(this.layout.symbols.success)} ${this.layout.theme.text("FOCUSED TEST PASSED")}`
      : `  ${this.layout.theme.error(this.layout.symbols.failure)} ${this.layout.theme.error("FOCUSED TEST FAILED")}`;

    const divider = this.layout.renderDivider();

    return [header, "", card, failureBlock, divider, "", banner].filter((s) => s.length > 0).join("\n");
  }
}
