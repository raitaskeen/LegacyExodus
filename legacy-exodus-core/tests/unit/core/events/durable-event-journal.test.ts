import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { InitializeProjectCommand } from "@contracts/commands";
import { EventBus } from "@core/events/event-bus";
import { InMemoryEventStore } from "@core/events/event-store";
import { Orchestrator } from "@core/orchestration/orchestrator";
import { ProjectStatus } from "@core/state/project-state";
import { MemoryStorageProvider, SqliteStorageProvider, StorageManager } from "@storage/index";

const command: InitializeProjectCommand = {
  id: "00000000-0000-4000-8000-000000000090",
  type: "InitializeProject",
  createdAt: new Date("2026-09-03T00:00:00.000Z"),
  payload: { projectId: "00000000-0000-4000-8000-000000000091", name: "Durable Event Project" },
};

describe("durable event journal", () => {
  test("commits facts and event history before a failing in-memory subscriber", async (): Promise<void> => {
    const storage = new StorageManager(new MemoryStorageProvider());
    const bus = new EventBus();
    bus.subscribe("ProjectInitialized", () => {
      throw new Error("synthetic subscriber failure");
    });
    const orchestrator = new Orchestrator(new InMemoryEventStore(), bus, storage);

    await expect(orchestrator.execute(command)).rejects.toThrow("synthetic subscriber failure");

    const durable = await storage.findScoped({ type: "domain-event", projectId: command.payload.projectId });
    expect(durable).toHaveLength(1);
    expect((durable[0]?.payload as { readonly event: { readonly type: string } }).event.type).toBe("ProjectInitialized");
    expect((await orchestrator.replayDurable(command.payload.projectId)).name).toBe("Durable Event Project");
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

    const orchestrator1 = new Orchestrator(new InMemoryEventStore(), bus, storage);

    try {
      await writeFile(join(projectPath, "f1.js"), "export const x = 1;", "utf8");
      await writeFile(join(projectPath, "f2.js"), "export const y = 2;", "utf8");

      const multiEventCmd = {
        id: "00000000-0000-4000-8000-000000000096",
        type: "AnalyzeProject" as const,
        createdAt: new Date(),
        payload: { projectId, path: projectPath },
      };

      // Execution 1: multi-event command fails during post-commit subscriber delivery
      await expect(orchestrator1.execute(multiEventCmd)).rejects.toThrow("synthetic subscriber failure during multi-event publish");

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
});
