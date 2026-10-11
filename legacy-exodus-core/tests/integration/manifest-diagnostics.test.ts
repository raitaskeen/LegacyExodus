import { computeFileAccounting, detectContamination, verifyCompleteness } from "../../benchmarks/governance";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createLegacyExodusEngine } from "@runtime/composition/services";

describe("manifest diagnostics integration", () => {
  test("preserves malformed manifest evidence through analysis and projection", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy exodus 清单 "));
    let engine: ReturnType<typeof createLegacyExodusEngine> | undefined;

    try {
      await mkdir(join(projectPath, "src"));
      await writeFile(join(projectPath, "src", "index.js"), "export const ready = true;", "utf8");
      await writeFile(join(projectPath, "package.json"), '{ "name":', "utf8");

      engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });
      await engine.initialize();
      const result = await engine.execute({
        id: "00000000-0000-4000-8000-000000000150",
        type: "AnalyzeProject",
        createdAt: new Date("2026-09-18T00:00:00.000Z"),
        payload: {
          projectId: "00000000-0000-4000-8000-000000000151",
          path: projectPath,
          refresh: true,
        },
      });

      expect(result.type).toBe("AnalyzeProject");
      if (result.type !== "AnalyzeProject") {
        throw new Error("Expected AnalyzeProject result.");
      }

      const expectedFailure = {
        path: "package.json",
        kind: "manifest-parse",
        code: "INVALID_JSON",
      } as const;

      expect(result.discovery.manifestFailures).toEqual([expectedFailure]);
      expect(result.discovery.dependencies).toEqual([]);
      expect(result.analysis.discoveryComplete).toBe(false);

      const project = JSON.parse(
        await readFile(join(projectPath, ".discovery", "project.json"), "utf8"),
      ) as { readonly manifestFailures?: readonly unknown[] };
      const summary = JSON.parse(
        await readFile(join(projectPath, ".discovery", "summary.json"), "utf8"),
      ) as { readonly manifestFailureCount?: number; readonly discoveryComplete: boolean };

      expect(project.manifestFailures).toEqual([expectedFailure]);
      expect(summary.manifestFailureCount).toBe(1);
      expect(summary.discoveryComplete).toBe(false);

      const reused = await engine.execute({
        id: "00000000-0000-4000-8000-000000000152",
        type: "AnalyzeProject",
        createdAt: new Date("2026-09-18T00:00:01.000Z"),
        payload: {
          projectId: "00000000-0000-4000-8000-000000000151",
          path: projectPath,
        },
      });

      expect(reused.type).toBe("AnalyzeProject");
      if (reused.type !== "AnalyzeProject") {
        throw new Error("Expected reused AnalyzeProject result.");
      }
      expect(reused.isReused).toBe(true);
      expect(reused.discovery.manifestFailures).toEqual([expectedFailure]);
      expect(reused.analysis.discoveryComplete).toBe(false);
      const expectedAccounting = { filesDiscovered: 2, filesAnalyzed: 1, parserFailures: 0,
        symbolExtractionFailures: 0, unsupportedFiles: 0, nonSourceArtifacts: 1, unclassifiedArtifacts: 0,
        enumerationFailures: 0, secondPassFailures: 0, discoveryComplete: false };
      for (const execution of [result, reused]) {
        expect(execution.analysis).toMatchObject(expectedAccounting);
        const accounting = computeFileAccounting(execution.analysis);
        expect(accounting).toMatchObject({ computedTotal: 2, discrepancy: 0, reconciles: true });
        expect(verifyCompleteness(execution.analysis, accounting, detectContamination([])).status).toBe("NEEDS_REVIEW");
      }
      const coldSummary = summary as typeof summary & { analysisDisposition: unknown };
      const warmSummary = JSON.parse(await readFile(join(projectPath, ".discovery", "summary.json"), "utf8"));
      expect(warmSummary.analysisDisposition).toEqual(coldSummary.analysisDisposition);
      expect(Object.hasOwn(warmSummary, "secondPassFailures")).toBe(false);
    } finally {
      await engine?.shutdown();
      await rm(projectPath, { force: true, recursive: true });
    }
  });
});
