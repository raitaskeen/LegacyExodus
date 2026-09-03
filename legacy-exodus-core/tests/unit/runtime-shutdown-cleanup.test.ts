import { describe, expect, it, spyOn } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ApplicationRuntime, type RuntimeService } from "@runtime/application";
import { createEngineContext } from "@runtime/composition/services";
import type { LegacyExodusPlugin } from "@plugins/plugin";
import { SqliteStorageProvider } from "@storage/adapters/sqlite-storage";
import { StorageManager } from "@storage/storage-manager";
import { createStorageRecord } from "@storage/storage-record";

describe("Runtime Shutdown Cleanup & Resource Disposal (F-006)", () => {
  it("1. normal shutdown cleans up services, plugins, and closes storage", async () => {
    const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    const runtime = context.runtime;

    const stoppedOrder: string[] = [];

    const svc1: RuntimeService = {
      name: "svc-1",
      start: () => {},
      stop: () => {
        stoppedOrder.push("svc-1");
      },
    };
    runtime.registerService(svc1);

    const plugin: LegacyExodusPlugin = {
      id: "test-plugin",
      name: "Test Plugin",
      version: "1.0.0",
      type: "parser",
      initialize: async () => {},
      shutdown: async () => {
        stoppedOrder.push("test-plugin");
      },
    };
    await runtime.getPluginLoader().load(plugin);
    expect(runtime.getPluginRegistry().has("test-plugin")).toBe(true);

    await runtime.start();
    expect(runtime.getStatus()).toBe("running");

    await runtime.shutdown();
    expect(runtime.getStatus()).toBe("stopped");

    // Plugin registry must be cleared and stop handlers called
    expect(stoppedOrder).toEqual(["svc-1", "test-plugin"]);
    expect(runtime.getPluginRegistry().has("test-plugin")).toBe(false);
  });

  it("2. repeated shutdown is idempotent and maintains stopped status", async () => {
    const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    const runtime = context.runtime;

    await runtime.start();
    expect(runtime.getStatus()).toBe("running");

    await runtime.shutdown();
    expect(runtime.getStatus()).toBe("stopped");

    // Second call safely no-ops without error
    await runtime.shutdown();
    expect(runtime.getStatus()).toBe("stopped");
  });

  it("3. startup failure rolls back started services and closes storage", async () => {
    const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    const runtime = context.runtime;

    const events: string[] = [];

    const svc1: RuntimeService = {
      name: "svc-1",
      start: () => {
        events.push("svc1-start");
      },
      stop: () => {
        events.push("svc1-stop");
      },
    };

    const svc2: RuntimeService = {
      name: "svc-2",
      start: () => {
        events.push("svc2-start");
        throw new Error("Svc2 init failed");
      },
      stop: () => {
        events.push("svc2-stop");
      },
    };

    runtime.registerService(svc1);
    runtime.registerService(svc2);

    await expect(runtime.start()).rejects.toThrow("Svc2 init failed");
    expect(runtime.getStatus()).toBe("stopped");
    expect(events).toEqual(["svc1-start", "svc2-start", "svc1-stop"]);
  });

  it("4. service stop failure does not abort remaining service, plugin, or storage cleanup", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "legacy-exodus-f006-sqlite-"));
    const dbPath = join(tempDir, "shutdown-test.sqlite");

    try {
      const sqliteProvider = new SqliteStorageProvider({ databasePath: dbPath });
      const closeSpy = spyOn(sqliteProvider, "close");
      const sqliteStorage = new StorageManager(sqliteProvider);
      const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });

      const runtime = new ApplicationRuntime(
        context.runtime.getConfig(),
        (context.runtime as any).logger,
        sqliteStorage,
        context.runtime.getPluginRegistry(),
        context.runtime.getPluginLoader(),
      );

      const cleanupEvents: string[] = [];

      const svc1: RuntimeService = {
        name: "svc-1",
        start: () => {},
        stop: () => {
          cleanupEvents.push("svc-1");
        },
      };

      const svc2: RuntimeService = {
        name: "svc-2",
        start: () => {},
        stop: () => {
          cleanupEvents.push("svc-2-fail");
          throw new Error("Service 2 stop failure");
        },
      };

      runtime.registerService(svc1);
      runtime.registerService(svc2);

      const plugin: LegacyExodusPlugin = {
        id: "plugin-p1",
        name: "Plugin P1",
        version: "1.0.0",
        type: "parser",
        initialize: async () => {},
        shutdown: async () => {
          cleanupEvents.push("plugin-p1");
        },
      };
      await runtime.getPluginLoader().load(plugin);

      await runtime.start();
      expect(runtime.getStatus()).toBe("running");

      // Write sample record to SQLite
      await sqliteStorage.save(createStorageRecord("test-type", { msg: "hello" }));

      // Shutdown must throw RUNTIME_SHUTDOWN_FAILED, but still stop svc-1, plugin, and close SQLite
      await expect(runtime.shutdown()).rejects.toThrow(
        expect.objectContaining({
          code: "RUNTIME_SHUTDOWN_FAILED",
          metadata: { failureCount: 1 },
        }),
      );

      // Status must still reach stopped
      expect(runtime.getStatus()).toBe("stopped");

      // svc-2 was stopped first (reverse order), svc-1 was stopped, and plugin was stopped
      expect(cleanupEvents).toEqual(["svc-2-fail", "svc-1", "plugin-p1"]);

      // Plugin was unregistered
      expect(runtime.getPluginRegistry().has("plugin-p1")).toBe(false);

      // Explicitly prove original sqliteProvider.close() was invoked exactly once before reopen
      expect(closeSpy).toHaveBeenCalledTimes(1);

      // Verify SQLite connection was closed: a new provider can open the file without lock error
      const freshProvider = new SqliteStorageProvider({ databasePath: dbPath });
      const freshStorage = new StorageManager(freshProvider);
      const records = await freshStorage.findAll("test-type");
      expect(records).toHaveLength(1);
      freshProvider.close();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("5. consecutive runtime instances cleanly acquire and release resources sequentially", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "legacy-exodus-f006-consecutive-"));
    const dbPath = join(tempDir, "consecutive.sqlite");

    try {
      for (let i = 1; i <= 3; i++) {
        const sqliteStorage = new StorageManager(new SqliteStorageProvider({ databasePath: dbPath }));
        const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });

        const runtime = new ApplicationRuntime(
          context.runtime.getConfig(),
          (context.runtime as any).logger,
          sqliteStorage,
          context.runtime.getPluginRegistry(),
          context.runtime.getPluginLoader(),
        );

        await runtime.start();
        expect(runtime.getStatus()).toBe("running");

        await sqliteStorage.save(createStorageRecord(`record-run-${i}`, { run: i }));

        await runtime.shutdown();
        expect(runtime.getStatus()).toBe("stopped");
      }

      // Verify all 3 runs successfully committed and closed cleanly
      const verifyProvider = new SqliteStorageProvider({ databasePath: dbPath });
      const verifyStorage = new StorageManager(verifyProvider);
      expect(await verifyStorage.findAll("record-run-1")).toHaveLength(1);
      expect(await verifyStorage.findAll("record-run-2")).toHaveLength(1);
      expect(await verifyStorage.findAll("record-run-3")).toHaveLength(1);
      verifyProvider.close();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("6. plugin shutdown failure does not prevent storage closure and runtime reaches stopped status", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "legacy-exodus-f006-plugin-fail-"));
    const dbPath = join(tempDir, "plugin-fail.sqlite");

    try {
      const sqliteProvider = new SqliteStorageProvider({ databasePath: dbPath });
      const closeSpy = spyOn(sqliteProvider, "close");
      const sqliteStorage = new StorageManager(sqliteProvider);
      const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });

      const runtime = new ApplicationRuntime(
        context.runtime.getConfig(),
        (context.runtime as any).logger,
        sqliteStorage,
        context.runtime.getPluginRegistry(),
        context.runtime.getPluginLoader(),
      );

      const faultyPlugin: LegacyExodusPlugin = {
        id: "failing-plugin",
        name: "Failing Plugin",
        version: "1.0.0",
        type: "parser",
        initialize: async () => {},
        shutdown: async () => {
          throw new Error("Plugin shutdown crashed");
        },
      };

      await runtime.getPluginLoader().load(faultyPlugin);
      await runtime.start();
      expect(runtime.getStatus()).toBe("running");

      await sqliteStorage.save(createStorageRecord("test-type", { key: "value" }));

      await expect(runtime.shutdown()).rejects.toThrow(
        expect.objectContaining({
          code: "RUNTIME_SHUTDOWN_FAILED",
          metadata: { failureCount: 1 },
        }),
      );

      expect(runtime.getStatus()).toBe("stopped");
      expect(runtime.getPluginRegistry().has("failing-plugin")).toBe(false);

      // Verify original sqliteProvider was closed exactly once
      expect(closeSpy).toHaveBeenCalledTimes(1);

      // Verify storage was closed cleanly despite plugin failure
      const reopenProvider = new SqliteStorageProvider({ databasePath: dbPath });
      const reopenStorage = new StorageManager(reopenProvider);
      expect(await reopenStorage.findAll("test-type")).toHaveLength(1);
      reopenProvider.close();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("7. storage close failure still transitions runtime to stopped status and reports error", async () => {
    const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });

    const faultyStorageProvider = {
      save: async () => {},
      findById: async () => null,
      findAll: async () => [],
      findScoped: async () => [],
      delete: async () => {},
      clear: async () => {},
      close: () => {
        throw new Error("Storage disk write lock failed during close");
      },
    };
    const faultyStorageManager = new StorageManager(faultyStorageProvider as any);

    const runtime = new ApplicationRuntime(
      context.runtime.getConfig(),
      (context.runtime as any).logger,
      faultyStorageManager,
      context.runtime.getPluginRegistry(),
      context.runtime.getPluginLoader(),
    );

    await runtime.start();
    expect(runtime.getStatus()).toBe("running");

    await expect(runtime.shutdown()).rejects.toThrow(
      expect.objectContaining({
        code: "RUNTIME_SHUTDOWN_FAILED",
        metadata: { failureCount: 1 },
      }),
    );

    expect(runtime.getStatus()).toBe("stopped");
  });

  it("8. concurrent shutdown calls coalesce to the same promise and perform cleanup once", async () => {
    const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    const runtime = context.runtime;

    let stopCallCount = 0;
    const slowService: RuntimeService = {
      name: "slow-service",
      start: () => {},
      stop: async () => {
        stopCallCount++;
        await new Promise((resolve) => setTimeout(resolve, 50));
      },
    };

    runtime.registerService(slowService);
    await runtime.start();
    expect(runtime.getStatus()).toBe("running");

    // Launch multiple concurrent shutdown calls
    await Promise.all([
      runtime.shutdown(),
      runtime.shutdown(),
      runtime.shutdown(),
    ]);

    expect(runtime.getStatus()).toBe("stopped");
    expect(stopCallCount).toBe(1);
  });

  // ─── RUNTIME-01: Startup Failure Cleanup & Shutdown Race Remediation ──────

  it("RUNTIME-01 Test 1: startup failure cleanup completes before runtime enters stopped state", async () => {
    const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    const runtime = context.runtime;

    let cleanupBarrierResolver: () => void = () => {};
    const cleanupBarrier = new Promise<void>((resolve) => {
      cleanupBarrierResolver = resolve;
    });

    let cleanupStarted = false;
    let cleanupCompleted = false;

    const svc1: RuntimeService = {
      name: "svc-controlled-cleanup",
      start: () => {},
      stop: async () => {
        cleanupStarted = true;
        await cleanupBarrier;
        cleanupCompleted = true;
      },
    };

    const svc2: RuntimeService = {
      name: "svc-failing",
      start: () => {
        throw new Error("Startup failure trigger");
      },
    };

    runtime.registerService(svc1);
    runtime.registerService(svc2);

    const startPromise = runtime.start();

    // Yield control so start() enters catch block and invokes cleanup
    await new Promise((resolve) => setImmediate(resolve));

    // Cleanup has begun, but barrier is not released
    expect(cleanupStarted).toBe(true);
    expect(cleanupCompleted).toBe(false);

    // INVARIANT 1: Runtime must NOT report "stopped" while cleanup is still running
    expect(runtime.getStatus()).toBe("stopping");

    // Release the barrier
    cleanupBarrierResolver();

    // Startup rejects with original startup error
    await expect(startPromise).rejects.toThrow("Startup failure trigger");

    // After cleanup completes, runtime reaches terminal "stopped" state
    expect(cleanupCompleted).toBe(true);
    expect(runtime.getStatus()).toBe("stopped");
  });

  it("RUNTIME-01 Test 2: concurrent shutdown() awaits in-flight startup failure cleanup", async () => {
    const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    const runtime = context.runtime;

    let cleanupBarrierResolver: () => void = () => {};
    const cleanupBarrier = new Promise<void>((resolve) => {
      cleanupBarrierResolver = resolve;
    });

    let cleanupCompleted = false;

    const svc1: RuntimeService = {
      name: "svc-blocking-cleanup",
      start: () => {},
      stop: async () => {
        await cleanupBarrier;
        cleanupCompleted = true;
      },
    };

    const svc2: RuntimeService = {
      name: "svc-failing",
      start: () => {
        throw new Error("Startup failed");
      },
    };

    runtime.registerService(svc1);
    runtime.registerService(svc2);

    const startPromise = runtime.start().catch(() => {});

    // Allow start() to fail and enter cleanup
    await new Promise((resolve) => setImmediate(resolve));
    expect(runtime.getStatus()).toBe("stopping");

    // T2 calls shutdown() while cleanup is in flight
    let shutdownResolved = false;
    const shutdownPromise = runtime.shutdown().then(() => {
      shutdownResolved = true;
    });

    // Yield to allow any premature synchronous resolution
    await new Promise((resolve) => setImmediate(resolve));

    // INVARIANT 2: shutdown() must NOT have resolved while cleanup is still blocked
    expect(shutdownResolved).toBe(false);
    expect(cleanupCompleted).toBe(false);
    expect(runtime.getStatus()).toBe("stopping");

    // Release cleanup barrier
    cleanupBarrierResolver();

    await Promise.all([startPromise, shutdownPromise]);

    // Both cleanup and shutdown are now complete
    expect(cleanupCompleted).toBe(true);
    expect(shutdownResolved).toBe(true);
    expect(runtime.getStatus()).toBe("stopped");
  });

  it("RUNTIME-01 Test 3: multiple concurrent shutdown callers during startup failure coalesce to single cleanup", async () => {
    const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    const runtime = context.runtime;

    let stopCount = 0;
    let barrierResolver: () => void = () => {};
    const barrier = new Promise<void>((resolve) => {
      barrierResolver = resolve;
    });

    const svc1: RuntimeService = {
      name: "svc-single-flight",
      start: () => {},
      stop: async () => {
        stopCount++;
        await barrier;
      },
    };

    const svc2: RuntimeService = {
      name: "svc-fail",
      start: () => {
        throw new Error("Early failure");
      },
    };

    runtime.registerService(svc1);
    runtime.registerService(svc2);

    const startPromise = runtime.start().catch(() => {});

    await new Promise((resolve) => setImmediate(resolve));

    // 3 concurrent callers invoke shutdown()
    const p1 = runtime.shutdown();
    const p2 = runtime.shutdown();
    const p3 = runtime.shutdown();

    barrierResolver();

    await Promise.all([startPromise, p1, p2, p3]);

    // INVARIANT 3: Cleanup executed exactly once (single-flight)
    expect(stopCount).toBe(1);
    expect(runtime.getStatus()).toBe("stopped");
  });

  it("RUNTIME-01 Test 4: startup error remains observable after cleanup completes", async () => {
    const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    const runtime = context.runtime;

    const svc1: RuntimeService = {
      name: "svc-1",
      start: () => {},
      stop: () => {},
    };

    const svc2: RuntimeService = {
      name: "svc-fail",
      start: () => {
        throw new Error("Specific startup failure message");
      },
    };

    runtime.registerService(svc1);
    runtime.registerService(svc2);

    // INVARIANT 4: Startup error is accurately propagated
    await expect(runtime.start()).rejects.toThrow("Specific startup failure message");
    expect(runtime.getStatus()).toBe("stopped");
  });

  it("RUNTIME-01 Test 5: startup failure takes precedence over cleanup failure and secondary cleanup error is logged", async () => {
    const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    const runtime = context.runtime;
    const logger = (runtime as any).logger;
    const errorSpy = spyOn(logger, "error");

    let svc1Stopped = false;

    const svc1: RuntimeService = {
      name: "svc-failing-cleanup",
      start: () => {},
      stop: () => {
        svc1Stopped = true;
        throw new Error("SECONDARY_CLEANUP_FAILURE");
      },
    };

    const svc2: RuntimeService = {
      name: "svc-failing-startup",
      start: () => {
        throw new Error("PRIMARY_STARTUP_FAILURE");
      },
      stop: () => {},
    };

    runtime.registerService(svc1);
    runtime.registerService(svc2);

    // Assert that start() rejects with the PRIMARY_STARTUP_FAILURE, NOT the cleanup error
    let thrownError: unknown;
    try {
      await runtime.start();
    } catch (err: unknown) {
      thrownError = err;
    }

    expect(thrownError).toBeDefined();
    expect((thrownError as Error).message).toBe("PRIMARY_STARTUP_FAILURE");
    expect((thrownError as Error).message).not.toContain("SECONDARY_CLEANUP_FAILURE");

    // Cleanup was still attempted
    expect(svc1Stopped).toBe(true);

    // Runtime reaches stopped state
    expect(runtime.getStatus()).toBe("stopped");

    // Secondary cleanup failure was logged via structured logger
    expect(errorSpy).toHaveBeenCalled();
    const cleanupLogCall = errorSpy.mock.calls.find((call) =>
      typeof call[1] === "string" && call[1].includes("Cleanup failed after startup failure")
    );
    expect(cleanupLogCall).toBeDefined();
    expect((cleanupLogCall?.[0] as any)?.error?.code).toBe("RUNTIME_SHUTDOWN_FAILED");

    errorSpy.mockRestore();
  });

  it("RUNTIME-01 Test 6: normal shutdown propagates cleanup failure and reaches stopped state", async () => {
    const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    const runtime = context.runtime;

    const svc1: RuntimeService = {
      name: "svc-failing-stop",
      start: () => {},
      stop: () => {
        throw new Error("SHUTDOWN_CLEANUP_FAILURE");
      },
    };

    runtime.registerService(svc1);
    await runtime.start();
    expect(runtime.getStatus()).toBe("running");

    // Normal shutdown must reject with RUNTIME_SHUTDOWN_FAILED containing the cleanup failure
    await expect(runtime.shutdown()).rejects.toThrow(
      expect.objectContaining({
        code: "RUNTIME_SHUTDOWN_FAILED",
      }),
    );

    // Runtime reaches terminal stopped state
    expect(runtime.getStatus()).toBe("stopped");
  });
});
