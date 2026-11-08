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
      "Analysis completed with isolated non-fatal faults",
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

  test("analyzeProject maps storagePath to engine environment and enables SQLite inference", async () => {
    const capturedEnv: Record<string, string | undefined>[] = [];
    const mockEngine = {
      initialize: async () => {},
      resolveProjectId: async () => "00000000-0000-4000-8000-000000000000",
      execute: async () => ({
        type: "AnalyzeProject",
        discovery: {
          projectName: "mock",
          files: [],
          languages: [],
          frameworks: [],
          dependencies: [],
        },
        analysis: {
          filesDiscovered: 0,
          filesAnalyzed: 0,
          parserFailures: 0,
          symbolExtractionFailures: 0,
          unsupportedFiles: 0,
          nonSourceArtifacts: 0,
          unclassifiedArtifacts: 0,
          durationMs: 1,
        },
      }),
      shutdown: async () => {},
    };

    const createMockEngine = (env?: Record<string, string | undefined>) => {
      if (env) capturedEnv.push(env);
      return mockEngine as any;
    };

    const { analyzeProject } = await import("@cli/commands/analyze");

    await analyzeProject("./dummy", createMockEngine, {
      storagePath: "./db.sqlite",
    });

    expect(capturedEnv).toHaveLength(1);
    expect(capturedEnv[0]?.LEGACY_EXODUS_STORAGE_DB_PATH).toBe("./db.sqlite");
    expect(capturedEnv[0]?.LEGACY_EXODUS_STORAGE_DRIVER).toBeUndefined();

    // Verify that the environment captured actually resolves to SQLite driver via loadRuntimeConfig
    const { loadRuntimeConfig } = await import("@runtime/config");
    const resolvedConfig = loadRuntimeConfig(capturedEnv[0]);
    expect(resolvedConfig.storageDriver).toBe("sqlite");
    expect(resolvedConfig.storageDatabasePath).toBe("./db.sqlite");
  });
});
