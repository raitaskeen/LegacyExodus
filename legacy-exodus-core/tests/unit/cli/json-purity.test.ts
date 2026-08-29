import { describe, expect, it } from "bun:test";
import { formatJsonOutput } from "@cli/output/json-output";
import type { StatusReport } from "@cli/commands/status";
import type { PluginListReport } from "@cli/commands/plugins";
import type { AnalyzeProjectReport } from "@cli/commands/analyze";

describe("CLI JSON Contract & Output Purity", () => {
  it("emits pure, parseable JSON for status without ANSI or banner pollution", () => {
    const report: StatusReport = {
      runtime: "running",
      storage: "ready",
      plugins: 3,
      version: "0.1.0",
    };

    const output = formatJsonOutput(report);

    expect(output).not.toContain("\x1b[");
    expect(output).not.toContain("LegacyExodus");
    expect(output).not.toContain("◈");
    expect(output).not.toContain("─");

    const parsed = JSON.parse(output);
    expect(parsed).toEqual(report);
  });

  it("emits pure, parseable JSON for plugins list without ANSI or banner pollution", () => {
    const report: PluginListReport = {
      plugins: [
        { id: "p1", name: "plugin-one", version: "1.0.0", type: "parser" },
        { id: "p2", name: "plugin-two", version: "2.0.0", type: "transform" },
      ],
    };

    const output = formatJsonOutput(report);

    expect(output).not.toContain("\x1b[");
    expect(output).not.toContain("Installed Plugins");
    expect(output).not.toContain("◈");

    const parsed = JSON.parse(output);
    expect(parsed).toEqual(report);
  });

  it("emits pure, parseable JSON for analyze project report", () => {
    const report: AnalyzeProjectReport = {
      projectName: "sample-app",
      files: 50,
      filesDiscovered: 50,
      languages: ["typescript", "javascript"],
      frameworks: ["express"],
      dependencies: 10,
      filesAnalyzed: 45,
      parserFailures: 0,
      symbolExtractionFailures: 0,
      unsupportedFiles: 0,
      nonSourceArtifacts: 5,
      unclassifiedArtifacts: 0,
      enumerationFailures: 0,
      discoveryComplete: true,
      durationMs: 142.5,
    };

    const output = formatJsonOutput(report);

    expect(output).not.toContain("\x1b[");
    expect(output).not.toContain("Discovery completed");
    expect(output).not.toContain("◈");
    expect(output).not.toContain("─");

    const parsed = JSON.parse(output);
    expect(parsed.projectName).toBe("sample-app");
    expect(parsed.filesDiscovered).toBe(50);
    expect(parsed.discoveryComplete).toBe(true);
  });
});
