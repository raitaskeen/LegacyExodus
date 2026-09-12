import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { LegacyExodusEngine } from "@core/engine";
import { loadDurableEvents } from "@core/events/durable-event-journal";
import { createEngineContext } from "@runtime/composition/services";
import { LegacyExodusError } from "@shared/errors";
import { SqliteStorageProvider, StorageManager } from "@storage/index";

describe("STORAGE-002 durable analysis and projection failure semantics", () => {
  test("reports a post-commit projection failure without misrepresenting durable analysis state", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-storage-002-project-"));
    const databaseDirectory = await mkdtemp(join(tmpdir(), "legacy-exodus-storage-002-db-"));
    const databasePath = join(databaseDirectory, "analysis.sqlite");
    const analysisRunId = "00000000-0000-4000-8000-000000000201";
    const projectId = "00000000-0000-4000-8000-000000000202";
    const discoveryBlocker = join(projectPath, ".discovery");
    const context = createEngineContext({
      LOG_LEVEL: "silent",
      NODE_ENV: "test",
      LEGACY_EXODUS_STORAGE_DRIVER: "sqlite",
      LEGACY_EXODUS_STORAGE_DB_PATH: databasePath,
    });
    const engine = new LegacyExodusEngine(context);
    let failure: unknown;
    let discoveryRecordCount = 0;
    let analysisRecordCount = 0;
    let blockerContent = "";
    let reopenedAnalysisRecordCount = 0;
    let reopenedEventTypes: readonly string[] = [];

    try {
      await writeFile(join(projectPath, "index.js"), "export const value = 42;", "utf8");
      await writeFile(discoveryBlocker, "projection blocked", "utf8");
      await engine.initialize();

      try {
        await engine.execute({
          id: analysisRunId,
          type: "AnalyzeProject",
          createdAt: new Date("2026-09-12T00:00:00.000Z"),
          payload: { projectId, path: projectPath },
        });
      } catch (error: unknown) {
        failure = error;
      }

      const discoveryRecords = await context.storage.findScoped({
        type: "project-discovery",
        projectId,
        analysisRunId,
      });
      const analysisRecords = await context.storage.findScoped({
        type: "analysis-run",
        projectId,
        analysisRunId,
      });
      discoveryRecordCount = discoveryRecords.length;
      analysisRecordCount = analysisRecords.length;
      blockerContent = await readFile(discoveryBlocker, "utf8");

      await engine.shutdown();

      const reopenedStorage = new StorageManager(new SqliteStorageProvider({ databasePath }));
      try {
        const durableEvents = await loadDurableEvents(reopenedStorage, projectId, analysisRunId);
        reopenedEventTypes = durableEvents.map((event) => event.type);
        reopenedAnalysisRecordCount = (await reopenedStorage.findScoped({
          type: "analysis-run",
          projectId,
          analysisRunId,
        })).length;
      } finally {
        await reopenedStorage.close();
      }
    } finally {
      await engine.shutdown();
      await rm(projectPath, { recursive: true, force: true });
      await rm(databaseDirectory, { recursive: true, force: true });
    }

    expect(failure).toBeInstanceOf(LegacyExodusError);
    if (!(failure instanceof LegacyExodusError)) {
      throw new Error("Expected a typed post-commit projection failure.");
    }

    expect(failure.code).toBe("DISCOVERY_PROJECTION_FAILED_AFTER_COMMIT");
    expect(failure.message).toBe("Analysis was committed, but discovery artifact projection failed.");
    expect(failure.metadata).toEqual({
      context: "Discovery Projection",
      projectId,
      analysisRunId,
      projectPath,
      analysisCommitted: true,
      projectionStatus: "failed",
      causeCode: "DISCOVERY_PROJECTION_PATH_UNSAFE",
      error: "Discovery projection output path is unsafe.",
    });
    expect(failure.cause).toBeInstanceOf(LegacyExodusError);
    if (!(failure.cause instanceof LegacyExodusError)) {
      throw new Error("Expected the projection failure cause to remain typed.");
    }
    expect(failure.cause.code).toBe("DISCOVERY_PROJECTION_PATH_UNSAFE");
    expect(discoveryRecordCount).toBe(1);
    expect(analysisRecordCount).toBe(1);
    expect(blockerContent).toBe("projection blocked");
    expect(reopenedEventTypes.filter((eventType) => eventType === "AnalysisRunCompleted")).toHaveLength(1);
    expect(reopenedAnalysisRecordCount).toBe(1);
  });
});
