import { describe, expect, test } from "bun:test";

import type { AnalyzeProjectReport } from "@cli/commands/analyze";
import { formatAnalyzeOutput } from "@cli/output/formatter";
import { formatJsonOutput } from "@cli/output/json-output";
import type { TerminalCapabilities } from "@cli/presentation/capabilities";
import { SummaryPresenter } from "@cli/presentation/summaries";
import { stripAnsi } from "@cli/presentation/theme";

const interactiveCapabilities: TerminalCapabilities = Object.freeze({
  isTTY: true,
  isCI: false,
  noColor: false,
  isUnicodeSupported: true,
  width: 100,
  mode: "interactive",
  theme: "classic",
});

const cleanReport: AnalyzeProjectReport = Object.freeze({
  projectName: "presentation-fixture",
  files: 3,
  filesDiscovered: 3,
  filesAnalyzed: 1,
  parserFailures: 0,
  symbolExtractionFailures: 0,
  unsupportedFiles: 0,
  nonSourceArtifacts: 2,
  unclassifiedArtifacts: 0,
  enumerationFailures: 0,
  discoveryComplete: true,
  durationMs: 1,
  languages: Object.freeze(["javascript"]),
  frameworks: Object.freeze([]),
  dependencies: 0,
});

function reportWith(
  changes: Partial<AnalyzeProjectReport>,
): AnalyzeProjectReport {
  return Object.freeze({ ...cleanReport, ...changes });
}

function renderInteractive(report: AnalyzeProjectReport): string {
  return stripAnsi(new SummaryPresenter(interactiveCapabilities).formatAnalyze(report));
}

describe("analyze presentation integrity", () => {
  test("retains the clean-success presentation only for a clean report", () => {
    const output = renderInteractive(cleanReport);

    expect(output).toContain("Discovery Complete");
    expect(output).toContain("yes");
    expect(output).toContain("COMPLETED");
    expect(output).toContain("Analysis and graph persistence completed successfully.");
    expect(output).not.toContain("Analysis completed with isolated non-fatal faults.");
  });

  test("presents a parser-only failure as degraded without denying completed discovery", () => {
    const output = renderInteractive(reportWith({ parserFailures: 1 }));

    expect(output).toContain("Parser Failures");
    expect(output).toContain("1 ISOLATED");
    expect(output).toContain("Discovery Complete");
    expect(output).toContain("yes");
    expect(output).toContain("Analysis completed with isolated non-fatal faults.");
    expect(output).not.toContain("Analysis and graph persistence completed successfully.");
  });

  test("presents a symbol-only failure as degraded", () => {
    const output = renderInteractive(reportWith({ symbolExtractionFailures: 1 }));

    expect(output).toContain("Symbol Extraction Failures");
    expect(output).toContain("1 ISOLATED");
    expect(output).toContain("Analysis completed with isolated non-fatal faults.");
    expect(output).not.toContain("Analysis and graph persistence completed successfully.");
  });

  test("keeps combined failures truthful and JSON structurally unchanged", () => {
    const report = reportWith({
      parserFailures: 1,
      symbolExtractionFailures: 2,
    });
    const interactive = renderInteractive(report);
    const plain = formatAnalyzeOutput(report);
    const json = formatJsonOutput(report);

    expect(interactive).toContain("Analysis completed with isolated non-fatal faults.");
    expect(interactive).not.toContain("Analysis and graph persistence completed successfully.");
    expect(plain.split("\n")[0]).toBe("Analysis completed with isolated non-fatal faults");
    expect(plain).toContain("Parser failures: 1");
    expect(plain).toContain("Symbol extraction failures: 2");
    expect(JSON.parse(json)).toEqual(report);
    expect(formatJsonOutput(report)).toBe(json);
  });

  test("presents manifest or enumeration degradation as non-fatal faults", () => {
    const report = reportWith({
      enumerationFailures: 1,
      discoveryComplete: false,
    });

    expect(renderInteractive(report)).toContain("Analysis completed with isolated non-fatal faults.");
    expect(formatAnalyzeOutput(report).split("\n")[0]).toBe(
      "Analysis completed with isolated non-fatal faults",
    );
  });

  test("keeps valid or absent manifest reports clean when no degradation evidence exists", () => {
    const validManifestOutput = renderInteractive(cleanReport);
    const absentManifestOutput = renderInteractive(
      reportWith({ discoveryComplete: undefined, enumerationFailures: 0 }),
    );

    expect(validManifestOutput).toContain("Analysis and graph persistence completed successfully.");
    expect(absentManifestOutput).toContain("Analysis and graph persistence completed successfully.");
  });

  test("renders identical output for repeated deterministic inputs", () => {
    const report = reportWith({ parserFailures: 1 });

    expect(renderInteractive(report)).toBe(renderInteractive(report));
    expect(formatAnalyzeOutput(report)).toBe(formatAnalyzeOutput(report));
    expect(formatJsonOutput(report)).toBe(formatJsonOutput(report));
  });
});
