import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { InitializeProjectCommand } from "@contracts/commands";
import { EventBus } from "@core/events/event-bus";
import { LegacyExodusEngine } from "@core/engine/engine";
import { InMemoryEventStore } from "@core/events/event-store";
import { Orchestrator } from "@core/orchestration/orchestrator";
import { ProjectStatus } from "@core/state/project-state";
import { createEngineContext } from "@runtime/composition/services";
import {
  MemoryStorageProvider,
  SqliteStorageProvider,
  StorageManager,
  type StorageRecord,
} from "@storage/index";

const command: InitializeProjectCommand = {
  id: "00000000-0000-4000-8000-000000000090",
  type: "InitializeProject",
  createdAt: new Date("2026-09-03T00:00:00.000Z"),
  payload: { projectId: "00000000-0000-4000-8000-000000000091", name: "Durable Event Project" },
};

describe("durable event journal", () => {
  test("treats durable commit as success when post-commit notification fails", async (): Promise<void> => {
    const storage = new StorageManager(new MemoryStorageProvider());
    const bus = new EventBus();
    let deliveryAttempts = 0;
    bus.subscribe("ProjectInitialized", () => {
      deliveryAttempts++;
      throw new Error("synthetic subscriber failure");
    });
    const orchestrator = new Orchestrator(new InMemoryEventStore(), bus, storage);

    const execution = await orchestrator.execute(command);
    const committedEvent = execution.events[0];
    if (committedEvent === undefined) {
      throw new Error("Expected ProjectInitialized event.");
    }

    expect(execution.events.map((event) => event.type)).toEqual(["ProjectInitialized"]);
    expect(deliveryAttempts).toBe(1);
    expect(orchestrator.getPostCommitEventDeliveryFailures().map((failure) => ({
      ...failure,
      error: failure.error instanceof Error ? failure.error.message : String(failure.error),
    }))).toEqual([
      {
        stage: "delivery",
        eventId: committedEvent.id,
        eventType: "ProjectInitialized",
        aggregateId: command.payload.projectId,
        error: "synthetic subscriber failure",
      },
    ]);
    const durable = await storage.findScoped({ type: "domain-event", projectId: command.payload.projectId });
    expect(durable).toHaveLength(1);
    expect((durable[0]?.payload as { readonly event: { readonly type: string } }).event.type).toBe("ProjectInitialized");
    expect((await orchestrator.replayDurable(command.payload.projectId)).name).toBe("Durable Event Project");
  });

  test("keeps the engine caller result aligned with a committed analysis run", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-arch-001-"));
    const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    const engine = new LegacyExodusEngine(context);
    const analysisRunId = "00000000-0000-4000-8000-000000000092";
    const projectId = "00000000-0000-4000-8000-000000000093";
    let deliveryAttempts = 0;

    context.eventBus.subscribe("AnalysisRunCompleted", () => {
      deliveryAttempts++;
      throw new Error("synthetic analysis completion subscriber failure");
    });

    try {
      await writeFile(join(projectPath, "index.js"), "export const ready = true;", "utf8");
      await engine.initialize();

      const result = await engine.execute({
        id: analysisRunId,
        type: "AnalyzeProject",
        createdAt: new Date("2026-09-12T00:00:00.000Z"),
        payload: { projectId, path: projectPath },
      });

      expect(result.type).toBe("AnalyzeProject");
      expect(deliveryAttempts).toBe(1);
      expect(context.orchestrator.getPostCommitEventDeliveryFailures().map((failure) => ({
        stage: failure.stage,
        eventType: failure.eventType,
        aggregateId: failure.aggregateId,
        error: failure.error instanceof Error ? failure.error.message : String(failure.error),
      }))).toEqual([{
        stage: "delivery",
        eventType: "AnalysisRunCompleted",
        aggregateId: projectId,
        error: "synthetic analysis completion subscriber failure",
      }]);
      expect((await context.storage.findScoped({ type: "analysis-run", projectId, analysisRunId }))
        .map((record) => (record.payload as { readonly status: string }).status)).toEqual(["completed"]);
    } finally {
      await engine.shutdown();
      await rm(projectPath, { force: true, recursive: true });
    }
  });

  test("replays committed events after SQLite storage is closed and reopened", async (): Promise<void> => {
    const databasePath = join(tmpdir(), `legacy-exodus-durable-events-${Date.now()}.sqlite`);
    let first: SqliteStorageProvider | undefined;
    let second: SqliteStorageProvider | undefined;

    try {
      first = new SqliteStorageProvider({ databasePath });
      const firstOrchestrator = new Orchestrator(
        new InMemoryEventStore(), new EventBus(), new StorageManager(first),
      );
      await firstOrchestrator.execute(command);
      first.close();
      first = undefined;

      second = new SqliteStorageProvider({ databasePath });
      const restarted = new Orchestrator(
        new InMemoryEventStore(), new EventBus(), new StorageManager(second),
      );
      const recovered = await restarted.replayDurable(command.payload.projectId);

      expect(recovered.name).toBe("Durable Event Project");
      expect(recovered.status).toBe(ProjectStatus.INITIALIZED);
      expect(firstOrchestrator.getPostCommitEventDeliveryFailures()).toEqual([]);
    } finally {
      first?.close();
      second?.close();
      await rm(databasePath, { force: true });
      await rm(`${databasePath}-wal`, { force: true });
      await rm(`${databasePath}-shm`, { force: true });
    }
  });

  test("maintains monotonic durable sequence across multi-event subscriber failures and process restarts", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-seq-"));
    const storage = new StorageManager(new MemoryStorageProvider());
    const bus = new EventBus();
    const projectId = "00000000-0000-4000-8000-000000000095";

    // Synthetic subscriber that fails after the second event
    let publishedCount = 0;
    bus.subscribe("FileDiscovered", () => {
      publishedCount++;
      if (publishedCount === 1) {
        throw new Error("synthetic subscriber failure during multi-event publish");
      }
    });

    const eventStore = new InMemoryEventStore();
    const orchestrator1 = new Orchestrator(eventStore, bus, storage);

    try {
      await writeFile(join(projectPath, "f1.js"), "export const x = 1;", "utf8");
      await writeFile(join(projectPath, "f2.js"), "export const y = 2;", "utf8");

      const multiEventCmd = {
        id: "00000000-0000-4000-8000-000000000096",
        type: "AnalyzeProject" as const,
        createdAt: new Date(),
        payload: { projectId, path: projectPath },
      };

      // Execution 1: post-commit delivery failure cannot reverse the durable command outcome.
      const execution = await orchestrator1.execute(multiEventCmd);
      expect(orchestrator1.getPostCommitEventDeliveryFailures()).toHaveLength(1);
      expect(orchestrator1.getPostCommitEventDeliveryFailures().map((failure) => ({
        stage: failure.stage,
        eventType: failure.eventType,
        aggregateId: failure.aggregateId,
        error: failure.error instanceof Error ? failure.error.message : String(failure.error),
      }))).toEqual([{
        stage: "delivery",
        eventType: "FileDiscovered",
        aggregateId: projectId,
        error: "synthetic subscriber failure during multi-event publish",
      }]);
      expect(eventStore.getAll().map((event) => event.id)).toEqual(execution.events.map((event) => event.id));
      expect(orchestrator1.replay().metadata.discoveredFileCount).toBe("2");

      // Verify records committed in Execution 1
      const initialDurable = await storage.findScoped({ type: "domain-event", projectId });
      expect(initialDurable.length).toBeGreaterThan(2);
      const initialSequences = initialDurable.map((r) => (r.payload as { readonly sequence: number }).sequence);

      // Subsequent execution on same storage (simulating restart / recovery)
      const bus2 = new EventBus();
      const orchestrator2 = new Orchestrator(new InMemoryEventStore(), bus2, storage);

      const nextCmd: InitializeProjectCommand = {
        id: "00000000-0000-4000-8000-000000000097",
        type: "InitializeProject",
        createdAt: new Date(),
        payload: { projectId, name: "Recovered Project" },
      };

      await orchestrator2.execute(nextCmd);

      const allDurable = await storage.findScoped({ type: "domain-event", projectId });
      const allSequences = allDurable.map((r) => (r.payload as { readonly sequence: number }).sequence).sort((a, b) => a - b);

      // Assert that every sequence is strictly unique and contiguous (no reused sequences!)
      expect(new Set(allSequences).size).toBe(allSequences.length);
      const maxInitialSeq = Math.max(...initialSequences);
      const nextSeq = (allDurable[allDurable.length - 1]?.payload as { readonly sequence: number }).sequence;
      expect(nextSeq).toBe(maxInitialSeq + 1);
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });

  test("preserves a genuine pre-commit persistence failure and skips notification delivery", async (): Promise<void> => {
    class RejectingCommitStorageProvider extends MemoryStorageProvider {
      public override async commitBatch(): Promise<readonly StorageRecord[]> {
        throw new Error("synthetic durable commit failure");
      }
    }

    const storage = new StorageManager(new RejectingCommitStorageProvider());
    const bus = new EventBus();
    let deliveryAttempts = 0;
    bus.subscribe("ProjectInitialized", () => {
      deliveryAttempts++;
    });
    const eventStore = new InMemoryEventStore();
    const orchestrator = new Orchestrator(eventStore, bus, storage);

    await expect(orchestrator.execute(command)).rejects.toThrow("synthetic durable commit failure");

    expect(deliveryAttempts).toBe(0);
    expect(eventStore.size()).toBe(0);
    expect(orchestrator.getPostCommitEventDeliveryFailures()).toEqual([]);
    expect(await storage.findScoped({ type: "domain-event", projectId: command.payload.projectId })).toEqual([]);
  });

  test("keeps committed success truthful when diagnostic reporting itself throws", async (): Promise<void> => {
    const storage = new StorageManager(new MemoryStorageProvider());
    const bus = new EventBus();
    bus.subscribe("ProjectInitialized", () => {
      throw new Error("synthetic subscriber failure");
    });
    const orchestrator = new Orchestrator(
      new InMemoryEventStore(),
      bus,
      storage,
      undefined,
      undefined,
      undefined,
      undefined,
      () => {
        throw new Error("synthetic diagnostic reporter failure");
      },
    );

    const execution = await orchestrator.execute(command);

    expect(execution.events.map((event) => event.type)).toEqual(["ProjectInitialized"]);
    expect(orchestrator.getPostCommitEventDeliveryFailures().map((failure) => ({
      stage: failure.stage,
      message: failure.error instanceof Error ? failure.error.message : String(failure.error),
    }))).toEqual([
      { stage: "delivery", message: "synthetic subscriber failure" },
      { stage: "reporting", message: "synthetic diagnostic reporter failure" },
    ]);
  });

  test("concurrent executions for the same aggregate reserve unique, non-overlapping durable sequences", async (): Promise<void> => {
    const storage = new StorageManager(new MemoryStorageProvider());
    const projectId = "00000000-0000-4000-8000-000000000099";

    const orch1 = new Orchestrator(new InMemoryEventStore(), new EventBus(), storage);
    const orch2 = new Orchestrator(new InMemoryEventStore(), new EventBus(), storage);

    const cmd1: InitializeProjectCommand = {
      id: "00000000-0000-4000-8000-000000000001",
      type: "InitializeProject",
      createdAt: new Date(),
      payload: { projectId, name: "Concurrent Project A" },
    };

    const cmd2: InitializeProjectCommand = {
      id: "00000000-0000-4000-8000-000000000002",
      type: "InitializeProject",
      createdAt: new Date(),
      payload: { projectId, name: "Concurrent Project B" },
    };

    // Trigger concurrent executions against the same storage
    await Promise.all([orch1.execute(cmd1), orch2.execute(cmd2)]);

    const records = await storage.findScoped({ type: "domain-event", projectId });
    const sequences = records.map((r) => (r.payload as { readonly sequence: number }).sequence);

    // Invariant 1: All durable sequence numbers for the aggregate must be strictly unique
    expect(new Set(sequences).size).toBe(sequences.length);
    expect(sequences.length).toBe(2);
    expect(sequences.sort((a, b) => a - b)).toEqual([0, 1]);
  });

  test("concurrent executions against SQLite reserve unique, non-overlapping durable sequences", async (): Promise<void> => {
    const tempDir = await mkdtemp(join(tmpdir(), "legacy-exodus-sqlite-concurrent-"));
    const dbPath = join(tempDir, "concurrent.sqlite");
    const provider = new SqliteStorageProvider({ databasePath: dbPath });
    const storage = new StorageManager(provider);
    const projectId = "00000000-0000-4000-8000-000000000098";

    const orch1 = new Orchestrator(new InMemoryEventStore(), new EventBus(), storage);
    const orch2 = new Orchestrator(new InMemoryEventStore(), new EventBus(), storage);

    const cmd1: InitializeProjectCommand = {
      id: "00000000-0000-4000-8000-000000000011",
      type: "InitializeProject",
      createdAt: new Date(),
      payload: { projectId, name: "Concurrent Sqlite A" },
    };

    const cmd2: InitializeProjectCommand = {
      id: "00000000-0000-4000-8000-000000000012",
      type: "InitializeProject",
      createdAt: new Date(),
      payload: { projectId, name: "Concurrent Sqlite B" },
    };

    try {
      await Promise.all([orch1.execute(cmd1), orch2.execute(cmd2)]);

      const records = await storage.findScoped({ type: "domain-event", projectId });
      const sequences = records.map((r) => (r.payload as { readonly sequence: number }).sequence);

      expect(new Set(sequences).size).toBe(sequences.length);
      expect(sequences.length).toBe(2);
      expect(sequences.sort((a, b) => a - b)).toEqual([0, 1]);
    } finally {
      provider.close();
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
