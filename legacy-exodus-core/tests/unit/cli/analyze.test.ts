import { describe, expect, test } from "bun:test";

import type { AnalyzeProjectReport } from "@cli/commands/analyze";
import { formatAnalyzeOutput } from "@cli/output/formatter";
import { formatJsonOutput } from "@cli/output/json-output";

const report: AnalyzeProjectReport = Object.freeze({
  projectName: "controlled-project",
  files: 6,
  filesDiscovered: 6,
  filesAnalyzed: 3,
  parserFailures: 1,
  symbolExtractionFailures: 1,
  unsupportedFiles: 1,
  nonSourceArtifacts: 2,
  unclassifiedArtifacts: 0,
  enumerationFailures: 0,
  discoveryComplete: true,
  durationMs: 12.5,
  languages: Object.freeze(["javascript", "json"]),
  frameworks: Object.freeze(["express"]),
  dependencies: 2,
});

describe("analyze command output", () => {
  test("reports every analysis disposition in concise human output", () => {
    expect(formatAnalyzeOutput(report)).toBe([
      "Discovery completed",
      "",
      "Project: controlled-project",
      "Files discovered: 6",
      "Files analyzed: 3",
      "Parser failures: 1",
      "Symbol extraction failures: 1",
      "Unsupported source files: 1",
      "Non-source artifacts: 2",
      "Unclassified files: 0",
      "Enumeration failures: 0",
      "Discovery complete: yes",
      "Analysis duration: 12.50ms",
      "Languages: javascript, json",
      "Frameworks: express",
      "Dependencies: 2",
    ].join("\n"));
  });

  test("keeps the structured report deterministic", () => {
    expect(formatJsonOutput(report)).toBe(formatJsonOutput(report));
    expect(JSON.parse(formatJsonOutput(report))).toEqual(report);
  });
});
