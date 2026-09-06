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

    // Batch A committed with sequence 0, 1 but later timestamps:
    const durableBatchA = [
      createDurableEventRecord({ ...eventA0, timestamp: new Date(baseTime + 500) }, 0),
      createDurableEventRecord({ ...eventA1, timestamp: new Date(baseTime + 500) }, 1),
    ];
    await storage.saveBatch(durableBatchA);

    // Batch B committed with sequence 2, 3 but earlier timestamps (non-monotonic / clock drift):
    const durableBatchB = [
      createDurableEventRecord({ ...eventB0, timestamp: new Date(baseTime) }, 2),
      createDurableEventRecord({ ...eventB1, timestamp: new Date(baseTime) }, 3),
    ];
    await storage.saveBatch(durableBatchB);

    const loaded = await loadDurableEvents(storage, projectId);
    const loadedTypes = loaded.map((e) => e.type);

    // Durable commit order must prevail over non-monotonic or equal timestamps:
    expect(loadedTypes).toEqual(["EventA0", "EventA1", "EventB0", "EventB1"]);
  });

  it("replays events with identical timestamps in durable sequence order (Case D)", async () => {
    const storage = new StorageManager(new MemoryStorageProvider());
    const projectId = "00000000-0000-4000-8000-000000000002";
    const exactSameTime = new Date("2026-09-06T00:00:00.000Z");

    const event0: DomainEvent = {
      id: "00000000-0000-4000-8000-000000000030",
      type: "FirstCommitted",
      timestamp: exactSameTime,
      aggregateId: projectId,
      payload: {},
    };
    const event1: DomainEvent = {
      id: "00000000-0000-4000-8000-000000000031",
      type: "SecondCommitted",
      timestamp: exactSameTime,
      aggregateId: projectId,
      payload: {},
    };
    const event2: DomainEvent = {
      id: "00000000-0000-4000-8000-000000000032",
      type: "ThirdCommitted",
      timestamp: exactSameTime,
      aggregateId: projectId,
      payload: {},
    };

    await storage.saveBatch([
      createDurableEventRecord(event0, 0),
      createDurableEventRecord(event1, 1),
      createDurableEventRecord(event2, 2),
    ]);

    const loaded = await loadDurableEvents(storage, projectId);
    expect(loaded.map((e) => e.type)).toEqual(["FirstCommitted", "SecondCommitted", "ThirdCommitted"]);
  });
});
