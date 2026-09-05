import { describe, expect, it } from "bun:test";
import type { DomainEvent } from "@core/events/domain-event";
import { createDurableEventRecord, loadDurableEvents } from "@core/events/durable-event-journal";
import { MemoryStorageProvider, StorageManager } from "@storage/index";

describe("Durable Event Replay Ordering", () => {
  it("preserves cross-execution causal event order without interleaving", async () => {
    const storage = new StorageManager(new MemoryStorageProvider());
    const projectId = "00000000-0000-4000-8000-000000000001";

    const baseTime = 1700000000000;
    const eventA0: DomainEvent = {
      id: "00000000-0000-4000-8000-000000000010",
      type: "EventA0",
      timestamp: new Date(baseTime),
      aggregateId: projectId,
      payload: { name: "A0" },
    };
    const eventA1: DomainEvent = {
      id: "00000000-0000-4000-8000-000000000011",
      type: "EventA1",
      timestamp: new Date(baseTime + 100),
      aggregateId: projectId,
      payload: { name: "A1" },
    };

    const eventB0: DomainEvent = {
      id: "00000000-0000-4000-8000-000000000020",
      type: "EventB0",
      timestamp: new Date(baseTime + 200),
      aggregateId: projectId,
      payload: { name: "B0" },
    };
    const eventB1: DomainEvent = {
      id: "00000000-0000-4000-8000-000000000021",
      type: "EventB1",
      timestamp: new Date(baseTime + 300),
      aggregateId: projectId,
      payload: { name: "B1" },
    };

    // Before fix: if sequence resets to 0 for both executions, loadDurableEvents sorts by sequence first:
    // A0 (seq 0), A1 (seq 1), B0 (seq 0), B1 (seq 1) -> [A0, B0, A1, B1]
    const durableBatchA = [
      createDurableEventRecord(eventA0, 0),
      createDurableEventRecord(eventA1, 1),
    ];
    await storage.saveBatch(durableBatchA);

    const durableBatchB = [
      createDurableEventRecord(eventB0, 0),
      createDurableEventRecord(eventB1, 1),
    ];
    await storage.saveBatch(durableBatchB);

    const loaded = await loadDurableEvents(storage, projectId);
    const loadedTypes = loaded.map((e) => e.type);

    // Causal expectation: Execution A events first, then Execution B events
    expect(loadedTypes).toEqual(["EventA0", "EventA1", "EventB0", "EventB1"]);
  });
});
