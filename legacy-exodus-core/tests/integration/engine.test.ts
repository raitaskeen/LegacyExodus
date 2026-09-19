import { describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LegacyExodusEngine, createLegacyExodusEngine } from "@core/engine";
import { loadDurableEvents } from "@core/events/durable-event-journal";
import { DiscoveryQueryService } from "@discovery/discovery-query-service";
import { createEngineContext } from "@runtime/composition/services";
import { LegacyExodusError } from "@shared/errors";
import { createStorageRecord } from "@storage/storage-record";

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function expectLegacyError(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(LegacyExodusError);
  expect((error as LegacyExodusError).code).toBe(code);
}

function expectSynchronousEngineError(operation: () => unknown, code: string): void {
  let caught: unknown;
  try {
    operation();
  } catch (error: unknown) {
    caught = error;
  }
  expectLegacyError(caught, code);
}

function analyzeCommand(runId: string, projectId: string, path: string) {
  return {
    id: runId,
    type: "AnalyzeProject" as const,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    payload: { projectId, path, refresh: true },
  };
}

async function createProjectFixture(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ name: "session-fixture", version: "1.0.0" }),
    "utf8",
  );
  await writeFile(join(directory, "index.js"), "export const value = 1;", "utf8");
  return directory;
}

describe("LegacyExodusEngine integration", () => {
  test("composes, initializes, reports health, and shuts down", async (): Promise<void> => {
    const engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });

    await engine.initialize();

    const status = engine.status();

    expect(status.state).toBe("running");
    expect(status.runtime).toBe("running");
    expect(status.components).toEqual({
      events: "ready",
      plugins: "ready",
      storage: "ready",
    });

    await engine.shutdown();

    expect(engine.status().state).toBe("stopped");
  });

  test("retains memory history until explicit reset and starts a clean reusable session", async (): Promise<void> => {
    const projectDir = await createProjectFixture("legacy-exodus-memory-session-");
    const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    const engine = new LegacyExodusEngine(context);
    const query = new DiscoveryQueryService(context.storage);
    const projectId = "00000000-0000-4000-8000-000000000101";
    const freshProjectId = "00000000-0000-4000-8000-000000000102";
    const firstRunId = "00000000-0000-4000-8000-000000000111";
    const secondRunId = "00000000-0000-4000-8000-000000000112";
    const thirdRunId = "00000000-0000-4000-8000-000000000113";

    try {
      await engine.initialize();
      await engine.execute(analyzeCommand(firstRunId, projectId, projectDir));
      await engine.execute(analyzeCommand(secondRunId, projectId, projectDir));

      expect((await query.listAnalysisRuns(projectId)).map((run) => run.analysisRunId)).toEqual([
        firstRunId,
        secondRunId,
      ]);
      expect((await query.getAnalysisRun(projectId, firstRunId))?.analysisRunId).toBe(firstRunId);
      expect(context.eventStore.getByType("AnalysisRunCompleted")).toHaveLength(2);

      await engine.resetSession();

      expect(engine.status().state).toBe("running");
      expect(await query.listAnalysisRuns(projectId)).toEqual([]);
      expect(await query.getAnalysisRun(projectId, firstRunId)).toBeNull();
      expect(context.eventStore.size()).toBe(0);

      await engine.execute(analyzeCommand(thirdRunId, freshProjectId, projectDir));

      expect(await query.listAnalysisRuns(projectId)).toEqual([]);
      expect((await query.listAnalysisRuns(freshProjectId)).map((run) => run.analysisRunId)).toEqual([
        thirdRunId,
      ]);
      expect(await query.getAnalysisRun(projectId, firstRunId)).toBeNull();
      expect((await query.getAnalysisRun(freshProjectId, thirdRunId))?.analysisRunId).toBe(thirdRunId);

      await engine.resetSession();
      await engine.resetSession();
      expect(await query.listAnalysisRuns(projectId)).toEqual([]);
      expect(engine.status().state).toBe("running");
    } finally {
      await engine.shutdown();
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("serializes concurrent reset, rejects execution during reset, and lets shutdown await it", async (): Promise<void> => {
    const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    const engine = new LegacyExodusEngine(context);
    const resetStarted = createDeferred();
    const releaseReset = createDeferred();
    const clearTransientSpy = spyOn(context.storage, "clearTransient").mockImplementation(async () => {
      resetStarted.resolve();
      await releaseReset.promise;
    });

    await engine.initialize();
    try {
      const resetA = engine.resetSession();

      let executionError: unknown;
      try {
        await engine.execute({
          id: "00000000-0000-4000-8000-000000000121",
          type: "SystemStatus",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        });
      } catch (error: unknown) {
        executionError = error;
      }
      expectLegacyError(executionError, "ENGINE_BUSY");

      await resetStarted.promise;
      const resetB = engine.resetSession();

      expect(resetB).toBe(resetA);
      expect(clearTransientSpy).toHaveBeenCalledTimes(1);

      const shutdown = engine.shutdown();
      expect(engine.status().state).toBe("stopping");
      expect(context.runtime.getStatus()).toBe("running");
      expectSynchronousEngineError(() => engine.resetSession(), "ENGINE_NOT_RUNNING");

      releaseReset.resolve();
      await Promise.all([resetA, resetB, shutdown]);

      expect(clearTransientSpy).toHaveBeenCalledTimes(1);
      expect(context.runtime.getStatus()).toBe("stopped");
      expect(engine.status().state).toBe("stopped");
    } finally {
      releaseReset.resolve();
      await engine.shutdown();
      clearTransientSpy.mockRestore();
    }
  });

  test("rejects reset while execution is active without clearing transient state", async (): Promise<void> => {
    const projectDir = await createProjectFixture("legacy-exodus-active-execution-");
    const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    const engine = new LegacyExodusEngine(context);
    const executionStarted = createDeferred();
    const releaseExecution = createDeferred();
    const originalExecute = context.orchestrator.execute.bind(context.orchestrator);
    const orchestratorSpy = spyOn(context.orchestrator, "execute").mockImplementation(async (command) => {
      executionStarted.resolve();
      await releaseExecution.promise;
      return originalExecute(command);
    });
    const clearTransientSpy = spyOn(context.storage, "clearTransient");

    try {
      await engine.initialize();
      const execution = engine.execute(analyzeCommand(
        "00000000-0000-4000-8000-000000000131",
        "00000000-0000-4000-8000-000000000132",
        projectDir,
      ));
      await executionStarted.promise;

      expectSynchronousEngineError(() => engine.resetSession(), "ENGINE_BUSY");
      expect(clearTransientSpy).toHaveBeenCalledTimes(0);

      releaseExecution.resolve();
      await execution;
    } finally {
      releaseExecution.resolve();
      await engine.shutdown();
      orchestratorSpy.mockRestore();
      clearTransientSpy.mockRestore();
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("rejects reset before initialization and after terminal shutdown", async (): Promise<void> => {
    const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    const engine = new LegacyExodusEngine(context);

    expectSynchronousEngineError(() => engine.resetSession(), "ENGINE_NOT_RUNNING");

    await engine.initialize();
    await engine.shutdown();

    expectSynchronousEngineError(() => engine.resetSession(), "ENGINE_NOT_RUNNING");
  });

  test("preserves SQLite records and durable events while resetting only process-local events", async (): Promise<void> => {
    const projectDir = await createProjectFixture("legacy-exodus-sqlite-session-");
    const databaseDir = await mkdtemp(join(tmpdir(), "legacy-exodus-sqlite-session-db-"));
    const databasePath = join(databaseDir, "session.sqlite");
    const environment = {
      LOG_LEVEL: "silent",
      NODE_ENV: "test",
      LEGACY_EXODUS_STORAGE_DRIVER: "sqlite",
      LEGACY_EXODUS_STORAGE_DB_PATH: databasePath,
    } as const;
    const projectId = "00000000-0000-4000-8000-000000000141";
    const runId = "00000000-0000-4000-8000-000000000142";
    const marker = createStorageRecord("session-marker", { projectId, value: "preserve" });
    const contextA = createEngineContext(environment);
    const engineA = new LegacyExodusEngine(contextA);

    try {
      await engineA.initialize();
      await engineA.execute(analyzeCommand(runId, projectId, projectDir));
      await contextA.storage.save(marker);
      const queryA = new DiscoveryQueryService(contextA.storage);
      const durableEventTypes = (await loadDurableEvents(contextA.storage, projectId))
        .map((event) => event.type);

      expect((await queryA.getAnalysisRun(projectId, runId))?.analysisRunId).toBe(runId);
      expect(contextA.eventStore.getByType("AnalysisRunCompleted")).toHaveLength(1);
      expect(durableEventTypes.filter((type) => type === "AnalysisRunCompleted")).toHaveLength(1);

      await engineA.resetSession();

      expect(contextA.eventStore.size()).toBe(0);
      expect(await contextA.storage.findById(marker.id)).toEqual(marker);
      expect((await loadDurableEvents(contextA.storage, projectId)).map((event) => event.type))
        .toEqual(durableEventTypes);
      expect((await queryA.getAnalysisRun(projectId, runId))?.analysisRunId).toBe(runId);

      await engineA.shutdown();

      const contextB = createEngineContext(environment);
      const engineB = new LegacyExodusEngine(contextB);
      await engineB.initialize();
      try {
        const queryB = new DiscoveryQueryService(contextB.storage);
        expect(await contextB.storage.findById(marker.id)).toEqual(marker);
        expect((await loadDurableEvents(contextB.storage, projectId)).map((event) => event.type))
          .toEqual(durableEventTypes);
        expect((await queryB.getAnalysisRun(projectId, runId))?.analysisRunId).toBe(runId);
      } finally {
        await engineB.shutdown();
      }
    } finally {
      await engineA.shutdown();
      await rm(projectDir, { recursive: true, force: true });
      await rm(databaseDir, { recursive: true, force: true });
    }
  });
});
