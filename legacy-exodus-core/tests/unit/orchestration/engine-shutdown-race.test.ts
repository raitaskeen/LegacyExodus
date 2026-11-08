import { describe, expect, it, spyOn } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEngineContext } from "@runtime/composition/services";
import { LegacyExodusEngine } from "@core/engine/engine";
import { LegacyExodusError } from "@shared/errors";
import type { Parser, ParseRequest, ParseResponse } from "@parser/index";
import { SqliteStorageProvider } from "@storage/adapters/sqlite-storage";
import { StorageManager } from "@storage/storage-manager";
import { createStorageRecord } from "@storage/storage-record";

class ControllablePausingParser implements Parser {
  public readonly id = "pausing-parser";
  public readonly name = "Pausing Parser";
  public readonly version = "1.0.0";
  public readonly supportedLanguages = Object.freeze(["javascript", "typescript"]);
  public readonly capabilities = Object.freeze(["ast", "comments", "exports", "imports", "locations"] as const);

  public constructor(private readonly pauseMs: number = 60) {}

  public canHandle(_request: ParseRequest): boolean {
    return true;
  }

  public async parse(request: ParseRequest): Promise<ParseResponse> {
    await new Promise((resolve) => setTimeout(resolve, this.pauseMs));
    return {
      result: {
        metadata: {
          parserId: this.id,
          language: request.file.language,
          sourcePath: request.file.path,
        },
        root: {
          type: "Program",
          attributes: {},
          children: [
            {
              type: "ExportNamedDeclaration",
              attributes: {},
              children: [
                {
                  type: "VariableDeclaration",
                  attributes: { kind: "const" },
                  children: [
                    {
                      type: "VariableDeclarator",
                      attributes: { name: "val" },
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
        statistics: { durationMs: 1, nodeCount: 4 },
        warnings: [],
        errors: [],
      },
    };
  }
}

describe("F-004 / F-005 / F-006: In-Flight Analysis vs Engine & Runtime Shutdown Lifecycle Contract", () => {
  it("1. in-flight analysis is gracefully drained before storage shutdown, preventing closed database errors (Case 1 & 2)", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "legacy-exodus-race-p1-"));
    const dbDir = await mkdtemp(join(tmpdir(), "legacy-exodus-race-db1-"));
    const dbPath = join(dbDir, "race.sqlite");

    try {
      for (let i = 0; i < 5; i++) {
        await writeFile(join(projectDir, `file_${i}.js`), `export const val_${i} = ${i};`, "utf8");
      }

      const context = createEngineContext({
        LOG_LEVEL: "silent",
        NODE_ENV: "test",
        LEGACY_EXODUS_STORAGE_DRIVER: "sqlite",
        LEGACY_EXODUS_STORAGE_DB_PATH: dbPath,
      });

      context.parserRegistry.unregister("javascript-parser");
      context.parserRegistry.register(new ControllablePausingParser(80));

      const engine = new LegacyExodusEngine(context);
      await engine.initialize();

      const analyzeCommand = {
        id: "00000000-0000-4000-8000-000000000010",
        type: "AnalyzeProject" as const,
        createdAt: new Date(),
        payload: {
          projectId: "00000000-0000-4000-8000-000000000020",
          path: projectDir,
        },
      };

      const execPromise = engine.execute(analyzeCommand);

      await new Promise((resolve) => setTimeout(resolve, 20));
      const shutdownPromise = engine.shutdown();

      const [execResult, shutdownResult] = await Promise.allSettled([execPromise, shutdownPromise]);

      expect(execResult.status).toBe("fulfilled");
      expect(shutdownResult.status).toBe("fulfilled");

      expect(engine.status().state).toBe("stopped");
      expect(context.runtime.getStatus()).toBe("stopped");

      const verifyProvider = new SqliteStorageProvider({ databasePath: dbPath });
      const verifyStorage = new StorageManager(verifyProvider);
      const discoveries = await verifyStorage.findAll("project-discovery");
      const symbols = await verifyStorage.findAll("symbol-table");
      const flowRecords = await verifyStorage.findAll("control-flow-analysis");
      expect(discoveries).toHaveLength(1);
      expect(symbols.length).toBeGreaterThan(0);
      expect(flowRecords).toHaveLength(1);
      verifyProvider.close();

      const manifestRaw = await readFile(join(projectDir, ".discovery", "manifest.json"), "utf8");
      const manifest = JSON.parse(manifestRaw);
      expect(manifest.analysis.analysisRunId).toBe("00000000-0000-4000-8000-000000000010");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
      await rm(dbDir, { recursive: true, force: true });
    }
  });

  it("2. new commands are rejected with ENGINE_NOT_RUNNING once engine shutdown has initiated (Case 2 boundary)", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "legacy-exodus-race-p2-"));
    const dbDir = await mkdtemp(join(tmpdir(), "legacy-exodus-race-db2-"));
    const dbPath = join(dbDir, "race.sqlite");

    try {
      await writeFile(join(projectDir, "test.js"), "export const x = 1;", "utf8");

      const context = createEngineContext({
        LOG_LEVEL: "silent",
        NODE_ENV: "test",
        LEGACY_EXODUS_STORAGE_DRIVER: "sqlite",
        LEGACY_EXODUS_STORAGE_DB_PATH: dbPath,
      });

      context.parserRegistry.unregister("javascript-parser");
      context.parserRegistry.register(new ControllablePausingParser(100));

      const engine = new LegacyExodusEngine(context);
      await engine.initialize();

      const cmd1 = {
        id: "00000000-0000-4000-8000-000000000001",
        type: "AnalyzeProject" as const,
        createdAt: new Date(),
        payload: { projectId: "00000000-0000-4000-8000-000000000002", path: projectDir },
      };

      const cmd2 = {
        id: "00000000-0000-4000-8000-000000000003",
        type: "AnalyzeProject" as const,
        createdAt: new Date(),
        payload: { projectId: "00000000-0000-4000-8000-000000000004", path: projectDir },
      };

      const p1 = engine.execute(cmd1);
      await new Promise((resolve) => setTimeout(resolve, 20));

      const shutdownPromise = engine.shutdown();

      await expect(engine.execute(cmd2)).rejects.toThrow(
        expect.objectContaining({ code: "ENGINE_NOT_RUNNING" }),
      );

      await Promise.all([p1, shutdownPromise]);
      expect(engine.status().state).toBe("stopped");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
      await rm(dbDir, { recursive: true, force: true });
    }
  });

  it("3. orchestrator stop gracefully waits for active execution when invoked directly via runtime (Case 3)", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "legacy-exodus-race-p3-"));
    const dbDir = await mkdtemp(join(tmpdir(), "legacy-exodus-race-db3-"));
    const dbPath = join(dbDir, "race.sqlite");

    try {
      await writeFile(join(projectDir, "main.js"), "export const a = 1;", "utf8");

      const context = createEngineContext({
        LOG_LEVEL: "silent",
        NODE_ENV: "test",
        LEGACY_EXODUS_STORAGE_DRIVER: "sqlite",
        LEGACY_EXODUS_STORAGE_DB_PATH: dbPath,
      });

      context.parserRegistry.unregister("javascript-parser");
      context.parserRegistry.register(new ControllablePausingParser(80));

      await context.runtime.start();
      expect(context.runtime.getStatus()).toBe("running");

      const cmd = {
        id: "00000000-0000-4000-8000-000000000050",
        type: "AnalyzeProject" as const,
        createdAt: new Date(),
        payload: { projectId: "00000000-0000-4000-8000-000000000060", path: projectDir },
      };

      const orchPromise = context.orchestrator.execute(cmd);
      await new Promise((resolve) => setTimeout(resolve, 20));

      const runtimeShutdownPromise = context.runtime.shutdown();

      const [orchResult, runtimeResult] = await Promise.allSettled([orchPromise, runtimeShutdownPromise]);

      expect(orchResult.status).toBe("fulfilled");
      expect(runtimeResult.status).toBe("fulfilled");
      expect(context.runtime.getStatus()).toBe("stopped");
      expect(context.orchestrator.getStatus()).toBe("stopped");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
      await rm(dbDir, { recursive: true, force: true });
    }
  });

  it("4. discovery projection service stop gracefully waits for in-flight project() calls and directory queue (Case 4 & 5)", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "legacy-exodus-race-p4-"));
    const dbDir = await mkdtemp(join(tmpdir(), "legacy-exodus-race-db4-"));
    const dbPath = join(dbDir, "race.sqlite");

    try {
      const context = createEngineContext({
        LOG_LEVEL: "silent",
        NODE_ENV: "test",
        LEGACY_EXODUS_STORAGE_DRIVER: "sqlite",
        LEGACY_EXODUS_STORAGE_DB_PATH: dbPath,
      });

      await context.runtime.start();
      expect(context.runtime.getStatus()).toBe("running");

      const projectId = "00000000-0000-4000-8000-000000000200";

      const record = createStorageRecord("project-discovery", {
        projectId,
        projectName: "Sample Project",
        projectPath: projectDir,
        languages: ["javascript"],
        files: [{ id: "f1", path: "app.js", language: "javascript", size: 100 }],
        dependencies: [],
        frameworks: [],
        discoveredAt: new Date().toISOString(),
      });

      await context.storage.save(record);

      // Launch project() concurrently and trigger runtime shutdown
      const projectPromise = context.discoveryProjection.project(record.id);
      const runtimeShutdownPromise = context.runtime.shutdown();

      const [projResult, runtimeResult] = await Promise.allSettled([projectPromise, runtimeShutdownPromise]);

      expect(projResult.status).toBe("fulfilled");
      expect(runtimeResult.status).toBe("fulfilled");
      expect(context.runtime.getStatus()).toBe("stopped");

      // Verify files were fully written to disk before shutdown
      const manifestRaw = await readFile(join(projectDir, ".discovery", "manifest.json"), "utf8");
      const manifest = JSON.parse(manifestRaw);
      expect(manifest.repository.name).toBe("Sample Project");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
      await rm(dbDir, { recursive: true, force: true });
    }
  });

  it("5. projection failure during execution does not poison runtime cleanup or leave unhandled rejection (Case 6 & 7)", async () => {
    const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    await context.runtime.start();

    // project() with non-existent ID throws DISCOVERY_RECORD_NOT_FOUND
    const badProj = context.discoveryProjection.project("00000000-0000-4000-8000-000000000999");
    const shutdownP = context.runtime.shutdown();

    const [projRes, shutRes] = await Promise.allSettled([badProj, shutdownP]);

    expect(projRes.status).toBe("rejected");
    expect(shutRes.status).toBe("fulfilled");
    expect(context.runtime.getStatus()).toBe("stopped");
  });

  it("6. projection service rejects new requests once stopped (Case 7 boundary)", async () => {
    const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    await context.runtime.start();
    await context.runtime.shutdown();

    expect(context.runtime.getStatus()).toBe("stopped");
    await expect(context.discoveryProjection.project("00000000-0000-4000-8000-000000000001")).rejects.toThrow(
      expect.objectContaining({ code: "PROJECTION_SERVICE_STOPPED" }),
    );
  });

  it("7. repeated concurrent analysis vs shutdown stress (100 runs) executes deterministically without error (Case 8)", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "legacy-exodus-race-stress-"));
    const dbDir = await mkdtemp(join(tmpdir(), "legacy-exodus-race-db-stress-"));

    try {
      await writeFile(join(projectDir, "test.js"), "export const x = 100;", "utf8");

      for (let run = 1; run <= 100; run++) {
        const dbPath = join(dbDir, `stress_${run}.sqlite`);
        const context = createEngineContext({
          LOG_LEVEL: "silent",
          NODE_ENV: "test",
          LEGACY_EXODUS_STORAGE_DRIVER: "sqlite",
          LEGACY_EXODUS_STORAGE_DB_PATH: dbPath,
        });

        const engine = new LegacyExodusEngine(context);
        await engine.initialize();

        const cmd = {
          id: `00000000-0000-4000-8000-${String(run).padStart(12, "0")}`,
          type: "AnalyzeProject" as const,
          createdAt: new Date(),
          payload: { projectId: "00000000-0000-4000-8000-000000000001", path: projectDir },
        };

        const execP = engine.execute(cmd);
        const shutdownP = engine.shutdown();

        const [r1, r2] = await Promise.allSettled([execP, shutdownP]);
        expect(r1.status).toBe("fulfilled");
        expect(r2.status).toBe("fulfilled");
        expect(engine.status().state).toBe("stopped");
      }
    } finally {
      await rm(projectDir, { recursive: true, force: true });
      await rm(dbDir, { recursive: true, force: true });
    }
  }, 60000);

  it("8. concurrent and repeated engine.shutdown() calls share the exact same in-flight operation and execute runtime.shutdown once", async () => {
    const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    const runtimeShutdownSpy = spyOn(context.runtime, "shutdown");

    const engine = new LegacyExodusEngine(context);
    await engine.initialize();
    expect(engine.status().state).toBe("running");

    // Case B: Concurrent calls share the in-progress operation
    const shutdownPromise1 = engine.shutdown();
    const shutdownPromise2 = engine.shutdown();
    const shutdownPromise3 = engine.shutdown();

    // Verify all return identical promise reference while in-flight
    expect(shutdownPromise2).toBe(shutdownPromise1);
    expect(shutdownPromise3).toBe(shutdownPromise1);

    const [res1, res2, res3] = await Promise.allSettled([shutdownPromise1, shutdownPromise2, shutdownPromise3]);

    expect(res1.status).toBe("fulfilled");
    expect(res2.status).toBe("fulfilled");
    expect(res3.status).toBe("fulfilled");
    expect(engine.status().state).toBe("stopped");

    // Runtime shutdown was called exactly once despite 3 concurrent calls
    expect(runtimeShutdownSpy).toHaveBeenCalledTimes(1);

    // Case C: Repeated calls after completion are idempotent and no-op
    await engine.shutdown();
    await engine.shutdown();
    expect(runtimeShutdownSpy).toHaveBeenCalledTimes(1);
    expect(engine.status().state).toBe("stopped");
  });

  it("9. concurrent shutdown calls during active execution wait for the same drain operation", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "legacy-exodus-race-concurrent-drain-"));
    try {
      await writeFile(join(projectDir, "index.js"), "export const val = 42;", "utf8");

      const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
      context.parserRegistry.unregister("javascript-parser");
      context.parserRegistry.register(new ControllablePausingParser(60));

      const runtimeShutdownSpy = spyOn(context.runtime, "shutdown");
      const engine = new LegacyExodusEngine(context);
      await engine.initialize();

      const cmd = {
        id: "00000000-0000-4000-8000-000000000888",
        type: "AnalyzeProject" as const,
        createdAt: new Date(),
        payload: { projectId: "00000000-0000-4000-8000-000000000999", path: projectDir },
      };

      const execP = engine.execute(cmd);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const shutP1 = engine.shutdown();
      const shutP2 = engine.shutdown();
      expect(shutP2).toBe(shutP1);

      const [execRes, shutRes1, shutRes2] = await Promise.allSettled([execP, shutP1, shutP2]);

      expect(execRes.status).toBe("fulfilled");
      expect(shutRes1.status).toBe("fulfilled");
      expect(shutRes2.status).toBe("fulfilled");
      expect(runtimeShutdownSpy).toHaveBeenCalledTimes(1);
      expect(engine.status().state).toBe("stopped");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});

describe("F05: bounded startup/shutdown publication race", () => {
  async function observeShutdownDuringStartup() {
    const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    const engine = new LegacyExodusEngine(context);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let startupReleased = false;
    let initializationSettled = false;
    context.runtime.registerService({
      name: "f05-resource-neutral-startup-gate",
      start: async () => {
        entered.resolve();
        await release.promise;
      },
    });
    const shutdownSpy = spyOn(context.runtime, "shutdown");
    const initialization = engine.initialize();
    const outcome = initialization.then(
      () => {
        initializationSettled = true;
        return { status: "fulfilled" as const };
      },
      (reason: unknown) => {
        initializationSettled = true;
        return { status: "rejected" as const, reason };
      },
    );

    try {
      await entered.promise;
      const beforeShutdown = engine.status();
      const shutdown = engine.shutdown();
      const duringShutdown = engine.status();
      const concurrentShutdown = engine.shutdown();
      const sameShutdownPromise = concurrentShutdown === shutdown;

      await shutdown;
      const afterShutdown = engine.status();
      const fulfilledWithStartupClosed = !startupReleased && !initializationSettled;
      release.resolve();
      startupReleased = true;
      const initializationOutcome = await outcome;
      const afterInitialization = engine.status();

      const executionOutcome = await engine.execute({
        id: "00000000-0000-4000-8000-000000000505",
        type: "SystemStatus",
        createdAt: new Date("2026-09-30T00:00:00.000Z"),
      }).then(
        () => ({ status: "fulfilled" as const }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      );
      let resetError: unknown;
      try {
        await engine.resetSession();
      } catch (error: unknown) {
        resetError = error;
      }

      await engine.shutdown();
      await engine.shutdown();
      return {
        beforeShutdown,
        duringShutdown,
        afterShutdown,
        afterInitialization,
        fulfilledWithStartupClosed,
        sameShutdownPromise,
        shutdownCalls: shutdownSpy.mock.calls.length,
        initializationOutcome,
        executionOutcome,
        resetError,
      };
    } finally {
      release.resolve();
      await outcome;
      await engine.shutdown();
      shutdownSpy.mockRestore();
    }
  }

  it("T01 normal initialize/shutdown preserves readiness and terminal states", async () => {
    const engine = new LegacyExodusEngine(createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" }));
    try {
      await engine.initialize();
      expect(engine.status()).toEqual({
        state: "running",
        runtime: "running",
        components: { events: "ready", plugins: "ready", storage: "ready" },
      });
      await engine.shutdown();
      expect(engine.status()).toEqual({
        state: "stopped",
        runtime: "stopped",
        components: { events: "not-ready", plugins: "not-ready", storage: "not-ready" },
      });
    } finally {
      await engine.shutdown();
    }
  });

  it("T02 shutdown enters stopping during explicitly gated runtime startup", async () => {
    const result = await observeShutdownDuringStartup();
    expect(result.beforeShutdown.state).toBe("created");
    expect(result.beforeShutdown.runtime).toBe("starting");
    expect(result.duringShutdown.state).toBe("stopping");
    expect(result.duringShutdown.components).toEqual({
      events: "not-ready", plugins: "not-ready", storage: "not-ready",
    });
  });

  it("T03 shutdown fulfills while initialization and its startup gate remain pending", async () => {
    const result = await observeShutdownDuringStartup();
    expect(result.fulfilledWithStartupClosed).toBe(true);
    expect(result.afterShutdown.state).toBe("stopped");
    expect(result.afterShutdown.runtime).toBe("stopped");
  });

  it("T04 interrupted initialize rejects with the existing lifecycle code and accurate message", async () => {
    const result = await observeShutdownDuringStartup();
    expect(result.initializationOutcome.status).toBe("rejected");
    if (result.initializationOutcome.status === "rejected") {
      expect(result.initializationOutcome.reason).toBeInstanceOf(LegacyExodusError);
      expect(result.initializationOutcome.reason).toMatchObject({
        code: "ENGINE_RESTART_NOT_SUPPORTED",
        message: "Initialization cannot complete because engine shutdown has begun.",
      });
    }
  });

  it("T05 late startup settlement cannot republish a running engine", async () => {
    const result = await observeShutdownDuringStartup();
    expect(result.afterInitialization.state).toBe("stopped");
  });

  it("T06 canonical resource-neutral fixture runtime remains stopped after startup settles", async () => {
    const result = await observeShutdownDuringStartup();
    expect(result.afterInitialization.runtime).toBe("stopped");
  });

  it("T07 late startup settlement cannot republish ready components", async () => {
    const result = await observeShutdownDuringStartup();
    expect(result.afterInitialization.components).toEqual({
      events: "not-ready", plugins: "not-ready", storage: "not-ready",
    });
  });

  it("T08 overlapping and repeated shutdown preserve promise identity and one cleanup", async () => {
    const result = await observeShutdownDuringStartup();
    expect(result.sameShutdownPromise).toBe(true);
    expect(result.shutdownCalls).toBe(1);
  });

  it("T09 execution remains blocked after interrupted startup settles", async () => {
    const result = await observeShutdownDuringStartup();
    expect(result.executionOutcome.status).toBe("rejected");
    if (result.executionOutcome.status === "rejected") {
      expect(result.executionOutcome.reason).toBeInstanceOf(LegacyExodusError);
      expect(result.executionOutcome.reason).toMatchObject({ code: "ENGINE_NOT_RUNNING" });
    }
  });

  it("T09 reset remains blocked after interrupted startup settles", async () => {
    const result = await observeShutdownDuringStartup();
    expect(result.resetError).toBeInstanceOf(LegacyExodusError);
    expect(result.resetError).toMatchObject({ code: "ENGINE_NOT_RUNNING" });
  });

  it("T10 100 fresh synchronized races have identical terminal outcomes", async () => {
    const outcomes: string[] = [];
    for (let iteration = 0; iteration < 100; iteration++) {
      const result = await observeShutdownDuringStartup();
      expect(result.initializationOutcome.status).toBe("rejected");
      expect(result.afterInitialization).toEqual({
        state: "stopped",
        runtime: "stopped",
        components: { events: "not-ready", plugins: "not-ready", storage: "not-ready" },
      });
      expect(result.fulfilledWithStartupClosed).toBe(true);
      expect(result.sameShutdownPromise).toBe(true);
      expect(result.shutdownCalls).toBe(1);
      expect(result.executionOutcome.status).toBe("rejected");
      expect(result.resetError).toMatchObject({ code: "ENGINE_NOT_RUNNING" });
      if (result.initializationOutcome.status === "rejected") {
        expect(result.initializationOutcome.reason).toMatchObject({
          code: "ENGINE_RESTART_NOT_SUPPORTED",
          message: "Initialization cannot complete because engine shutdown has begun.",
        });
        outcomes.push(JSON.stringify({
          status: result.afterInitialization,
          initialization: result.initializationOutcome.status,
          execution: result.executionOutcome.status,
          shutdownCalls: result.shutdownCalls,
        }));
      }
    }
    expect(outcomes).toHaveLength(100);
    expect(new Set(outcomes).size).toBe(1);
  });

  for (const shutdownBeforeRejection of [false, true]) {
    it("NR-A preserves exact primary startup error identity; shutdown=" + shutdownBeforeRejection, async () => {
      const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
      const engine = new LegacyExodusEngine(context);
      const rejectionGate = Promise.withResolvers<void>();
      const sentinel = new Error("F05 primary startup sentinel");
      const startSpy = spyOn(context.runtime, "start").mockImplementation(() => rejectionGate.promise);
      const initialization = engine.initialize();
      const outcome = initialization.then(
        () => ({ status: "fulfilled" as const }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      );
      try {
        if (shutdownBeforeRejection) {
          await engine.shutdown();
        }
        rejectionGate.reject(sentinel);
        const result = await outcome;
        expect(result.status).toBe("rejected");
        if (result.status === "rejected") {
          expect(result.reason).toBe(sentinel);
        }
      } finally {
        rejectionGate.reject(sentinel);
        await outcome;
        await engine.shutdown();
        startSpy.mockRestore();
      }
    });
  }

  it("NR-B initialization remains idempotent while running and restart remains prohibited", async () => {
    const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    const engine = new LegacyExodusEngine(context);
    const startSpy = spyOn(context.runtime, "start");
    try {
      await engine.initialize();
      await engine.initialize();
      expect(startSpy).toHaveBeenCalledTimes(1);
      const shutdown = engine.shutdown();
      await expect(engine.initialize()).rejects.toMatchObject({
        code: "ENGINE_RESTART_NOT_SUPPORTED",
        message: "A stopped engine instance cannot be restarted.",
      });
      await shutdown;
      await expect(engine.initialize()).rejects.toMatchObject({
        code: "ENGINE_RESTART_NOT_SUPPORTED",
        message: "A stopped engine instance cannot be restarted.",
      });
      expect(engine.status().state).toBe("stopped");
      expect(startSpy).toHaveBeenCalledTimes(1);
    } finally {
      await engine.shutdown();
      startSpy.mockRestore();
    }
  });

  it("NR-C interrupted initialization cannot publish while engine shutdown is still stopping", async () => {
    const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    const engine = new LegacyExodusEngine(context);
    const entered = Promise.withResolvers<void>();
    const releaseStartup = Promise.withResolvers<void>();
    const cleanupEntered = Promise.withResolvers<void>();
    const releaseCleanup = Promise.withResolvers<void>();
    context.runtime.registerService({
      name: "f05-resource-neutral-stopping-gate",
      start: async () => {
        entered.resolve();
        await releaseStartup.promise;
      },
    });
    const originalShutdown = context.runtime.shutdown.bind(context.runtime);
    const shutdownSpy = spyOn(context.runtime, "shutdown").mockImplementation(async () => {
      cleanupEntered.resolve();
      await releaseCleanup.promise;
      await originalShutdown();
    });
    const initialization = engine.initialize();
    const outcome = initialization.then(
      () => ({ status: "fulfilled" as const }),
      (reason: unknown) => ({ status: "rejected" as const, reason }),
    );
    try {
      await entered.promise;
      const shutdown = engine.shutdown();
      await cleanupEntered.promise;
      releaseStartup.resolve();
      const result = await outcome;
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.reason).toMatchObject({
          code: "ENGINE_RESTART_NOT_SUPPORTED",
          message: "Initialization cannot complete because engine shutdown has begun.",
        });
      }
      expect(engine.status().state).toBe("stopping");
      expect(engine.status().components).toEqual({
        events: "not-ready", plugins: "not-ready", storage: "not-ready",
      });
      releaseCleanup.resolve();
      await shutdown;
      expect(engine.status().state).toBe("stopped");
      expect(context.runtime.getStatus()).toBe("stopped");
    } finally {
      releaseStartup.resolve();
      releaseCleanup.resolve();
      await outcome;
      await engine.shutdown();
      shutdownSpy.mockRestore();
    }
  });
});
