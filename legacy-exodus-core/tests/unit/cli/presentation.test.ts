import { describe, expect, it } from "bun:test";

import {
  detectTerminalCapabilities,
  type TerminalCapabilities,
} from "@cli/presentation/capabilities";
import { createTheme, stripAnsi } from "@cli/presentation/theme";
import { createSymbols } from "@cli/presentation/symbols";
import { LayoutRenderer } from "@cli/presentation/layout";
import { TableRenderer } from "@cli/presentation/tables";
import { ErrorPresenter, extractErrorDetails } from "@cli/presentation/errors";
import { SummaryPresenter } from "@cli/presentation/summaries";
import { VerificationPresenter } from "@cli/presentation/verification";
import { ProgressTracker } from "@cli/presentation/progress";
import { CliError } from "@cli/errors";
import { ConfigurationError, LegacyExodusError } from "@shared/errors";

describe("CLI Presentation Subsystem", () => {
  const interactiveCaps: TerminalCapabilities = {
    isTTY: true,
    isCI: false,
    noColor: false,
    isUnicodeSupported: true,
    width: 80,
    mode: "interactive",
    theme: "classic",
  };

  const plainCaps: TerminalCapabilities = {
    isTTY: false,
    isCI: false,
    noColor: true,
    isUnicodeSupported: false,
    width: 80,
    mode: "plain",
    theme: "mono",
  };

  const ciCaps: TerminalCapabilities = {
    isTTY: false,
    isCI: true,
    noColor: false,
    isUnicodeSupported: true,
    width: 80,
    mode: "ci",
    theme: "mono",
  };

  // ─── 1. Terminal Capabilities ─────────────────────────────────────────────
  describe("Terminal Capabilities Detection", () => {
    it("detects json mode when requested", () => {
      const caps = detectTerminalCapabilities({ json: true });
      expect(caps.mode).toBe("json");
    });

    it("detects plain mode when requested", () => {
      const caps = detectTerminalCapabilities({ plain: true });
      expect(caps.mode).toBe("plain");
    });

    it("defaults to safe 80 width when columns are unavailable", () => {
      const caps = detectTerminalCapabilities({ stream: {} as any });
      expect(caps.width).toBe(80);
    });
  });

  // ─── 2. Color Theme & ANSI Stripping ──────────────────────────────────────
  describe("Color Theme & ANSI Stripping", () => {
    it("applies ANSI escape codes in interactive mode", () => {
      const theme = createTheme(interactiveCaps);
      const styled = theme.brand("LegacyExodus");
      expect(styled).toContain("\x1b[");
      expect(stripAnsi(styled)).toBe("LegacyExodus");
    });

    it("returns plain text when color is disabled", () => {
      const theme = createTheme(plainCaps);
      expect(theme.brand("LegacyExodus")).toBe("LegacyExodus");
      expect(theme.success("Passed")).toBe("Passed");
      expect(theme.error("Failed")).toBe("Failed");
    });

    it("stripAnsi removes all escape codes cleanly", () => {
      const raw = "\x1b[38;2;56;189;248m\x1b[1mTitle\x1b[0m";
      expect(stripAnsi(raw)).toBe("Title");
    });
  });

  // ─── 3. Symbol System ─────────────────────────────────────────────────────
  describe("Symbol System", () => {
    it("provides Unicode glyphs when supported", () => {
      const symbols = createSymbols(interactiveCaps);
      expect(symbols.success).toBe("✓");
      expect(symbols.failure).toBe("✗");
      expect(symbols.warning).toBe("⚠");
      expect(symbols.brand).toBe("◈");
    });

    it("provides ASCII fallbacks in plain/non-Unicode mode", () => {
      const symbols = createSymbols(plainCaps);
      expect(symbols.success).toBe("[+]");
      expect(symbols.failure).toBe("[x]");
      expect(symbols.warning).toBe("[!]");
      expect(symbols.brand).toBe("*");
    });
  });

  // ─── 4. Layout & Panels ───────────────────────────────────────────────────
  describe("Layout & Panels", () => {
    it("renders compact and full logo", () => {
      const layout = new LayoutRenderer(interactiveCaps);
      const compact = layout.renderLogo(false);
      expect(compact).toContain("LegacyExodus");

      const full = layout.renderLogo(true);
      expect(full).toContain("██╗");
      expect(full).toContain("v0.1.0");
      expect(full.split("\n").length).toBe(13);
    });

    it("falls back to compact logo in narrow terminals or plain mode", () => {
      const narrowCaps: TerminalCapabilities = {
        mode: "interactive",
        isTTY: true,
        isCI: false,
        noColor: false,
        isUnicodeSupported: true,
        width: 60,
        theme: "classic",
      };
      const narrowLayout = new LayoutRenderer(narrowCaps);
      const outNarrow = narrowLayout.renderLogo(true);
      expect(outNarrow).toContain("LegacyExodus");
      expect(outNarrow).not.toContain("██╗");

      const plainLayout = new LayoutRenderer(plainCaps);
      const outPlain = plainLayout.renderLogo(true);
      expect(outPlain).toContain("LegacyExodus");
      expect(outPlain).not.toContain("██╗");
    });

    it("renders section header with divider rule", () => {
      const layout = new LayoutRenderer(interactiveCaps);
      const header = layout.renderHeader("Runtime Status");
      expect(header).toContain("LegacyExodus");
      expect(header).toContain("Runtime Status");
    });

    it("aligns key-value cards cleanly", () => {
      const layout = new LayoutRenderer(plainCaps);
      const card = layout.renderCard([
        { label: "Runtime", value: "running" },
        { label: "Storage Engine", value: "SQLite" },
      ]);
      expect(card).toContain("Runtime");
      expect(card).toContain("running");
      expect(card).toContain("Storage Engine");
      expect(card).toContain("SQLite");
    });

    it("truncates long paths symmetrically", () => {
      const layout = new LayoutRenderer(plainCaps);
      const short = layout.truncatePath("src/index.ts", 30);
      expect(short).toBe("src/index.ts");

      const long = layout.truncatePath("very/long/nested/directory/structure/file-name.ts", 20);
      expect(long).toContain("...");
      expect(long.length).toBeLessThanOrEqual(20);
    });
  });

  // ─── 5. Tables ────────────────────────────────────────────────────────────
  describe("Table Renderer", () => {
    it("renders auto-aligning tabular data with headers and separators", () => {
      const tables = new TableRenderer(plainCaps);
      const output = tables.renderTable(
        [
          { key: "name", header: "Name" },
          { key: "count", header: "Count", align: "right" },
        ],
        [
          { name: "Parser", count: 42 },
          { name: "Symbols", count: 128 },
        ],
      );

      expect(output).toContain("Name     Count");
      expect(output).toContain("Parser      42");
      expect(output).toContain("Symbols    128");
    });

    it("handles empty tables gracefully", () => {
      const tables = new TableRenderer(plainCaps);
      const output = tables.renderTable([{ key: "name", header: "Name" }], []);
      expect(output).toContain("No data to display.");
    });

    it("truncates long columns to fit within narrow terminal width", () => {
      const narrowCaps: TerminalCapabilities = {
        ...interactiveCaps,
        width: 60,
      };
      const tables = new TableRenderer(narrowCaps);
      const output = tables.renderTable(
        [
          { key: "plugin", header: "Plugin" },
          { key: "id", header: "Identifier" },
        ],
        [
          {
            plugin: "legacy-exodus-ast-analyzer-engine",
            id: "plugin:ast:express:migration:v1:analyzer:implementation",
          },
        ],
      );

      const lines = output.split("\n");
      for (const line of lines) {
        expect(stripAnsi(line).length).toBeLessThanOrEqual(60);
      }
      expect(output).toContain("...");
    });

    it("safely truncates ANSI-styled cell content without breaking escape codes", () => {
      const narrowCaps: TerminalCapabilities = {
        ...interactiveCaps,
        width: 50,
      };
      const tables = new TableRenderer(narrowCaps);
      const theme = createTheme(interactiveCaps);
      const output = tables.renderTable(
        [
          { key: "status", header: "Status" },
          { key: "description", header: "Description" },
        ],
        [
          {
            status: theme.success("SUCCESS"),
            description: theme.warning("A very long warning message that must be truncated within narrow terminal bounds"),
          },
        ],
      );

      const lines = output.split("\n");
      for (const line of lines) {
        expect(stripAnsi(line).length).toBeLessThanOrEqual(50);
      }
      expect(output).toContain("\x1b[");
      expect(output).toContain("...");
    });

    it("produces deterministic output across repeated renders at multiple viewports", () => {
      for (const width of [120, 80, 60, 40, 32]) {
        const caps: TerminalCapabilities = { ...interactiveCaps, width };
        const tables = new TableRenderer(caps);
        const cols = [
          { key: "col1", header: "Header 1" },
          { key: "col2", header: "Header 2" },
        ];
        const data = [{ col1: "Long text value number one", col2: "Long text value number two" }];

        const render1 = tables.renderTable(cols, data);
        const render2 = tables.renderTable(cols, data);
        expect(render1).toBe(render2);
        for (const line of render1.split("\n")) {
          expect(stripAnsi(line).length).toBeLessThanOrEqual(width);
        }
      }
    });
  });

  // ─── 6. Error Presentation ────────────────────────────────────────────────
  describe("Error Presentation", () => {
    it("extracts details and remediation for CliError", () => {
      const err = new CliError("WORKSPACE_NOT_FOUND", "Directory missing");
      const details = extractErrorDetails(err);
      expect(details.code).toBe("WORKSPACE_NOT_FOUND");
      expect(details.remediation).toBeDefined();
    });

    it("extracts details for ConfigurationError", () => {
      const err = new ConfigurationError("Missing required key");
      const details = extractErrorDetails(err);
      expect(details.code).toBe("CONFIG_INVALID");
      expect(details.message).toContain("Missing required key");
    });

    it("extracts details for LegacyExodusError", () => {
      const err = new LegacyExodusError({
        code: "DISCOVERY_PATH_NOT_FOUND",
        message: "Path does not exist",
        metadata: { path: "/repo/missing", runId: "run-1" },
      });
      const details = extractErrorDetails(err);
      expect(details.code).toBe("DISCOVERY_PATH_NOT_FOUND");
      expect(details.path).toBe("/repo/missing");
      expect(details.runId).toBe("run-1");
    });

    it("renders structured error card in interactive and plain modes", () => {
      const presenterInteractive = new ErrorPresenter(interactiveCaps);
      const presenterPlain = new ErrorPresenter(plainCaps);

      const err = new CliError("TEST_CODE", "Sample error message");
      const interactiveOut = presenterInteractive.renderError(err);
      const plainOut = presenterPlain.renderError(err);

      expect(interactiveOut).toContain("TEST_CODE");
      expect(plainOut).toContain("Error: Sample error message");
      expect(plainOut).toContain("TEST_CODE");
    });
  });

  // ─── 7. Command Summaries ─────────────────────────────────────────────────
  describe("Command Summaries Presenter", () => {
    it("formats status summary in interactive and plain mode", () => {
      const presenter = new SummaryPresenter(interactiveCaps);
      const out = presenter.formatStatus({
        runtime: "running",
        storage: "ready",
        plugins: 0,
        version: "0.1.0",
      });
      expect(out).toContain("██╗");
      expect(out).toContain("Runtime Status");
      expect(out).toContain("RUNNING");
      expect(out).toContain("Ready");
      expect(out).toContain("Runtime healthy");

      const presenterPlain = new SummaryPresenter(plainCaps);
      const outPlain = presenterPlain.formatStatus({
        runtime: "running",
        storage: "ready",
        plugins: 0,
        version: "0.1.0",
      });
      expect(outPlain).not.toContain("██╗");
      expect(outPlain).toContain("LegacyExodus Status");
      expect(outPlain).toContain("Runtime: running");
    });

    it("formats init summary with metadata path", () => {
      const presenter = new SummaryPresenter(interactiveCaps);
      const out = presenter.formatInit({
        workspace: "/my/app",
        metadataPath: "/my/app/.legacy-exodus/config.json",
        metadata: { version: "0.1.0", createdAt: "2026-08-28", projectState: "initialized" },
      });
      expect(out).toContain("Workspace Initialization");
      expect(out).toContain("/my/app/.legacy-exodus/config.json");
    });

    it("formats analyze summary with complete breakdown", () => {
      const presenter = new SummaryPresenter(interactiveCaps);
      const out = presenter.formatAnalyze({
        projectName: "web-app",
        files: 100,
        filesDiscovered: 100,
        filesAnalyzed: 80,
        parserFailures: 0,
        symbolExtractionFailures: 0,
        unsupportedFiles: 5,
        nonSourceArtifacts: 15,
        unclassifiedArtifacts: 0,
        enumerationFailures: 0,
        discoveryComplete: true,
        durationMs: 120.5,
        languages: ["typescript"],
        frameworks: ["express"],
        dependencies: 12,
      });

      const cleanOut = stripAnsi(out);
      expect(cleanOut).toContain("Analysis Summary");
      expect(cleanOut).toContain("web-app");
      expect(cleanOut).toContain("100 total");
      expect(cleanOut).toContain("80");
      expect(cleanOut).toContain("120.50 ms");
    });
  });

  // ─── 8. Verification Presenter ────────────────────────────────────────────
  describe("Verification Presenter", () => {
    it("renders test summary card", () => {
      const presenter = new VerificationPresenter(interactiveCaps);
      const out = presenter.renderTestSummary({
        suitesPassed: 73,
        suitesTotal: 73,
        testsPassed: 495,
        testsFailed: 0,
        testsSkipped: 0,
        assertionsTotal: 3586,
        durationMs: 1250,
      });

      expect(out).toContain("Test Suite Verification");
      expect(out).toContain("73 passed of 73");
      expect(out).toContain("3,586 expect() checks");
      expect(out).toContain("100% contract compliance");
    });

    it("renders full test suite with category breakdown and coverage", () => {
      const presenter = new VerificationPresenter(interactiveCaps);
      const out = presenter.renderFullTestSuite({
        isFocused: false,
        suitesPassed: 74,
        suitesTotal: 74,
        testsPassed: 521,
        testsFailed: 0,
        testsSkipped: 0,
        assertionsTotal: 3653,
        durationMs: 14460,
        categories: [
          { name: "Core Contracts", passed: 18, failed: 0 },
          { name: "Discovery", passed: 42, failed: 0 },
          { name: "Parser", passed: 31, failed: 0 },
          { name: "Symbols", passed: 54, failed: 0 },
        ],
        coverage: {
          statementsPct: 92.4,
          functionsPct: 91.4,
          linesPct: 92.4,
          isHealthy: true,
        },
        failures: [],
      });

      expect(out).toContain("Test Verification");
      expect(out).toContain("Core Contracts");
      expect(out).toContain("18 passed");
      expect(out).toContain("521 passed");
      expect(out).toContain("3,653 expect() checks");
      expect(out).toContain("Coverage");
      expect(out).toContain("92.4%");
      expect(out).toContain("ALL TESTS PASSED");
    });

    it("renders focused test suite with target path and assertion counts", () => {
      const presenter = new VerificationPresenter(interactiveCaps);
      const out = presenter.renderFocusedTestSuite({
        target: "tests/unit/storage/sqlite-storage.test.ts",
        testsPassed: 11,
        testsFailed: 0,
        assertionsTotal: 34,
        durationMs: 412,
      });

      expect(out).toContain("Focused Test");
      expect(out).toContain("tests/unit/storage/sqlite-storage.test.ts");
      expect(out).toContain("11 passed");
      expect(out).toContain("34 expect() checks");
      expect(out).toContain("412 ms");
      expect(out).toContain("FOCUSED TEST PASSED");
    });

    it("renders typecheck summary", () => {
      const presenter = new VerificationPresenter(interactiveCaps);
      const out = presenter.renderTypecheckSummary({
        errors: 0,
        fileCount: 142,
        durationMs: 820,
      });
      expect(out).toContain("Static Typecheck");
      expect(out).toContain("142 files verified");
      expect(out).toContain("ZERO ERRORS");
    });

    it("renders benchmark audit summary", () => {
      const presenter = new VerificationPresenter(interactiveCaps);
      const out = presenter.renderBenchmarkAudit({
        totalChecks: 10,
        passedChecks: 10,
        failedChecks: 0,
        verdict: "PASS",
        engineSha: "5efdbab585bb",
        auditedAt: "2026-08-28T08:00:00Z",
      });
      expect(out).toContain("Benchmark Governance Audit");
      expect(out).toContain("10 of 10 passed");
      expect(out).toContain("VERIFIED");
    });

    it("renders composite verification dashboard", () => {
      const presenter = new VerificationPresenter(interactiveCaps);
      const out = presenter.renderVerificationDashboard(
        [
          { name: "Typecheck", status: "pass", details: "0 errors in 142 files", durationMs: 800 },
          { name: "Test Suite", status: "pass", details: "495 passed", durationMs: 1200 },
          { name: "Benchmark Audit", status: "pass", details: "10/10 checks", durationMs: 200 },
        ],
        2200,
      );

      expect(out).toContain("Repository Verification Dashboard");
      expect(out).toContain("Typecheck");
      expect(out).toContain("Test Suite");
      expect(out).toContain("Benchmark Audit");
      expect(out).toContain("ALL GATES PASSED");
    });

    it("renders composite verification dashboard with failure diagnostics when a gate fails", () => {
      const presenter = new VerificationPresenter(interactiveCaps);
      const out = presenter.renderVerificationDashboard(
        [
          { name: "Typecheck", status: "pass", details: "0 errors", durationMs: 800 },
          { name: "Test Suite", status: "fail", details: "1 failed", durationMs: 1200, diagnostics: "tests/unit/foo.test.ts\nExpected: 3\nReceived: 2" },
          { name: "Benchmark Audit", status: "pass", details: "10/10 checks", durationMs: 200 },
        ],
        2200,
      );

      expect(out).toContain("Repository Verification Dashboard");
      expect(out).toContain("1 OF 3 GATES FAILED");
      expect(out).toContain("Failure Diagnostics");
      expect(out).toContain("Test Suite");
      expect(out).toContain("tests/unit/foo.test.ts");
    });
  });

  // ─── 9. Progress Tracker ──────────────────────────────────────────────────
  describe("Progress Tracker", () => {
    it("records phase lifecycles cleanly in plain and CI modes", () => {
      const tracker = new ProgressTracker(plainCaps);
      tracker.registerPhases([
        { id: "discovery", name: "Discovery" },
        { id: "parsing", name: "Parsing" },
      ]);

      tracker.startPhase("discovery", "100 files");
      tracker.completePhase("discovery", "100 files", 50);
      tracker.startPhase("parsing");
      tracker.completePhase("parsing", undefined, 120);
      tracker.stop();

      const ciTracker = new ProgressTracker(ciCaps);
      ciTracker.registerPhases([{ id: "storage", name: "Storage" }]);
      ciTracker.startPhase("storage");
      ciTracker.completePhase("storage", "indexed", 30);
      ciTracker.stop();
    });
  });
});
