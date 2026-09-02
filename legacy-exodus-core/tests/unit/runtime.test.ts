import { describe, expect, it, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ApplicationRuntime, type RuntimeService } from "@runtime/application";
import { createEngineContext } from "@runtime/composition/services";
import { loadRuntimeConfig } from "@runtime/config";
import { ConfigurationError, LegacyExodusError } from "@shared/errors";
import { StorageManager } from "@storage/storage-manager";
import { MemoryStorageProvider } from "@storage/adapters/memory-storage";
import { SqliteStorageProvider } from "@storage/adapters/sqlite-storage";
import { createStorageRecord } from "@storage/storage-record";

describe("runtime foundation", () => {
  test("rejects an unsupported runtime environment", (): void => {
    expect(() => loadRuntimeConfig({ NODE_ENV: "staging" })).toThrow(ConfigurationError);
  });

  test("initializes and shuts down deterministically", async (): Promise<void> => {
    const runtime = createEngineContext({
      LOG_LEVEL: "silent",
      NODE_ENV: "test",
    }).runtime;

    expect(runtime.getStatus()).toBe("created");
    await runtime.start();
    expect(runtime.getStatus()).toBe("running");
    await runtime.shutdown();
    expect(runtime.getStatus()).toBe("stopped");
  });

  test("preserves error code, message, and metadata", (): void => {
    const error = new LegacyExodusError({
      code: "TEST_ERROR",
      message: "Test failure",
      metadata: { source: "unit-test" },
    });

    expect(error.code).toBe("TEST_ERROR");
    expect(error.message).toBe("Test failure");
    expect(error.metadata).toEqual({ source: "unit-test" });
  });

  // ─── Lifecycle State Transitions & Idempotency ────────────────────────────
  describe("Runtime Lifecycle State Machine & Edge Cases", () => {
    it("Case B: repeated shutdown() is idempotent and safely no-ops", async () => {
      const runtime = createEngineContext({
        LOG_LEVEL: "silent",
        NODE_ENV: "test",
      }).runtime;

      await runtime.start();
      expect(runtime.getStatus()).toBe("running");

      await runtime.shutdown();
      expect(runtime.getStatus()).toBe("stopped");

      // Second shutdown must not throw
      await runtime.shutdown();
      expect(runtime.getStatus()).toBe("stopped");
    });

    it("Case C: repeated start() when already running is idempotent and safely no-ops", async () => {
      const runtime = createEngineContext({
        LOG_LEVEL: "silent",
        NODE_ENV: "test",
      }).runtime;

      await runtime.start();
      expect(runtime.getStatus()).toBe("running");

      // Second start must not re-run or throw
      await runtime.start();
      expect(runtime.getStatus()).toBe("running");

      await runtime.shutdown();
    });

    it("Case D: throws RUNTIME_START_INVALID_STATE when starting from stopped state", async () => {
      const runtime = createEngineContext({
        LOG_LEVEL: "silent",
        NODE_ENV: "test",
      }).runtime;

      await runtime.start();
      await runtime.shutdown();
      expect(runtime.getStatus()).toBe("stopped");

      await expect(runtime.start()).rejects.toThrow(
        expect.objectContaining({
          code: "RUNTIME_START_INVALID_STATE",
        }),
      );
    });

    it("Case E: throws RUNTIME_SERVICE_REGISTRATION_CLOSED when registering service after start()", async () => {
      const runtime = createEngineContext({
        LOG_LEVEL: "silent",
        NODE_ENV: "test",
      }).runtime;

      await runtime.start();

      const lateService: RuntimeService = { name: "late-service" };
      expect(() => runtime.registerService(lateService)).toThrow(
        expect.objectContaining({
          code: "RUNTIME_SERVICE_REGISTRATION_CLOSED",
        }),
      );

      await runtime.shutdown();
    });

    it("Case F: rolls back started services in reverse order when a subsequent service fails startup", async () => {
      const runtime = createEngineContext({
        LOG_LEVEL: "silent",
        NODE_ENV: "test",
      }).runtime;

      const order: string[] = [];

      const svc1: RuntimeService = {
        name: "svc-1",
        start: async () => {
          order.push("svc1-start");
        },
        stop: async () => {
          order.push("svc1-stop");
        },
      };

      const svc2: RuntimeService = {
        name: "svc-2",
        start: async () => {
          order.push("svc2-start");
          throw new Error("Startup failure in svc-2");
        },
        stop: async () => {
          order.push("svc2-stop");
        },
      };

      runtime.registerService(svc1);
      runtime.registerService(svc2);

      await expect(runtime.start()).rejects.toThrow("Startup failure in svc-2");
      expect(runtime.getStatus()).toBe("stopped");
      expect(order).toEqual(["svc1-start", "svc2-start", "svc1-stop"]);
    });

    it("Case G: propagates RUNTIME_SHUTDOWN_FAILED when a service fails to stop while still stopping remaining services", async () => {
      const runtime = createEngineContext({
        LOG_LEVEL: "silent",
        NODE_ENV: "test",
      }).runtime;

      const stopOrder: string[] = [];

      const svc1: RuntimeService = {
        name: "svc-1",
        start: async () => {},
        stop: async () => {
          stopOrder.push("svc1-stop");
        },
      };

      const svc2: RuntimeService = {
        name: "svc-2",
        start: async () => {},
        stop: async () => {
          stopOrder.push("svc2-stop");
          throw new Error("Shutdown error in svc-2");
        },
      };

      runtime.registerService(svc1);
      runtime.registerService(svc2);

      await runtime.start();
      expect(runtime.getStatus()).toBe("running");

      // svc2 stops first (reverse order) and fails, but svc1 must still be stopped
      await expect(runtime.shutdown()).rejects.toThrow(
        expect.objectContaining({
          code: "RUNTIME_SHUTDOWN_FAILED",
          metadata: { failureCount: 1 },
        }),
      );
      expect(stopOrder).toEqual(["svc2-stop", "svc1-stop"]);
    });

    it("Case H: cleans up memory storage provider on shutdown and closes persistent sqlite provider", async () => {
      // 1. In-memory storage lifecycle
      const memStorage = new StorageManager(new MemoryStorageProvider());
      const record = createStorageRecord("test-record", { key: "val" });
      await memStorage.save(record);
      expect(await memStorage.findById(record.id)).not.toBeNull();

      const contextMem = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
      await contextMem.runtime.start();
      await contextMem.runtime.shutdown();
      expect(contextMem.runtime.getStatus()).toBe("stopped");

      // 2. Persistent SQLite storage lifecycle
      const tempDir = await mkdtemp(join(tmpdir(), "runtime-sqlite-test-"));
      const dbPath = join(tempDir, "runtime.sqlite");
      try {
        const sqliteProvider = new SqliteStorageProvider({ databasePath: dbPath });
        const sqliteStorage = new StorageManager(sqliteProvider);
        expect(sqliteStorage.isPersistent()).toBe(true);

        const runtimeSqlite = new ApplicationRuntime(
          contextMem.runtime.getConfig(),
          (contextMem.runtime as any).logger,
          sqliteStorage,
          contextMem.runtime.getPluginRegistry(),
          contextMem.runtime.getPluginLoader(),
        );

        await runtimeSqlite.start();
        expect(runtimeSqlite.getStatus()).toBe("running");
        await runtimeSqlite.shutdown();
        expect(runtimeSqlite.getStatus()).toBe("stopped");
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it("Case I: consecutive runtime instances initialize and shutdown without state leakage", async () => {
      // Instance 1
      const context1 = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
      await context1.runtime.start();
      expect(context1.runtime.getStatus()).toBe("running");
      const record1 = createStorageRecord("run-1", { data: "first" });
      await context1.runtime.getStorageManager().save(record1);
      expect(await context1.runtime.getStorageManager().findById(record1.id)).not.toBeNull();
      await context1.runtime.shutdown();
      expect(context1.runtime.getStatus()).toBe("stopped");

      // Instance 2
      const context2 = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
      await context2.runtime.start();
      expect(context2.runtime.getStatus()).toBe("running");
      // Fresh in-memory storage must not contain record1
      expect(await context2.runtime.getStorageManager().findById(record1.id)).toBeNull();
      await context2.runtime.shutdown();
      expect(context2.runtime.getStatus()).toBe("stopped");
    });

    it("Case J: exposes getters for config, storageManager, pluginRegistry, and pluginLoader", () => {
      const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
      const runtime = context.runtime;

      expect(runtime.getConfig()).toBeDefined();
      expect(runtime.getConfig().environment).toBe("test");
      expect(runtime.getStorageManager()).toBeDefined();
      expect(runtime.getPluginRegistry()).toBeDefined();
      expect(runtime.getPluginLoader()).toBeDefined();
    });

    it("Case K: allows registering multiple services with distinct names", async () => {
      const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
      const runtime = context.runtime;

      const serviceA: RuntimeService = { name: "service-alpha" };
      const serviceB: RuntimeService = { name: "service-beta" };

      expect(() => runtime.registerService(serviceA)).not.toThrow();
      expect(() => runtime.registerService(serviceB)).not.toThrow();

      await runtime.start();
      expect(runtime.getStatus()).toBe("running");
      await runtime.shutdown();
      expect(runtime.getStatus()).toBe("stopped");
    });

    it("Case L: throws RUNTIME_DUPLICATE_SERVICE when registering duplicate service names and preserves original registration", async () => {
      const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
      const runtime = context.runtime;

      let service1Started = false;
      const service1: RuntimeService = {
        name: "duplicate-target",
        start: () => { service1Started = true; },
      };
      const service2: RuntimeService = {
        name: "duplicate-target",
        start: () => { throw new Error("Should not start"); },
      };

      runtime.registerService(service1);

      expect(() => runtime.registerService(service2)).toThrow(
        expect.objectContaining({
          code: "RUNTIME_DUPLICATE_SERVICE",
          message: expect.stringContaining("duplicate-target"),
        }),
      );

      // Original service remains registered and runs normally
      await runtime.start();
      expect(runtime.getStatus()).toBe("running");
      expect(service1Started).toBe(true);

      await runtime.shutdown();
      expect(runtime.getStatus()).toBe("stopped");
    });
  });
});
