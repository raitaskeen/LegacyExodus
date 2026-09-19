import { describe, expect, test } from "bun:test";

import {
  createStorageRecord,
  StorageManager,
  type SerializedPayload,
  type StorageProvider,
  type StorageQueryCriteria,
  type StorageRecord,
} from "@storage/index";

describe("StorageManager", () => {
  test("delegates operations to its injected storage provider", async (): Promise<void> => {
    const savedRecordIds: string[] = [];
    let closed = false;
    let cleared = false;
    let deletedId = "";
    let scopedCriteria: any = null;
    const iteratedCriteria: StorageQueryCriteria[] = [];
    const streamedRecords = [
      createStorageRecord("project", { name: "First project" }),
      createStorageRecord("project", { name: "Second project" }),
    ];

    const provider: StorageProvider = {
      save: async (record): Promise<void> => {
        savedRecordIds.push(record.id);
      },
      findById: async (): Promise<null> => null,
      findAll: async (): Promise<[]> => [],
      findScoped: async (criteria): Promise<[]> => {
        scopedCriteria = criteria;
        return [];
      },
      iterateScoped: async function* <Payload extends SerializedPayload>(
        criteria: StorageQueryCriteria,
      ): AsyncIterable<StorageRecord<Payload>> {
        iteratedCriteria.push(criteria);
        for (const streamedRecord of streamedRecords) {
          yield streamedRecord as StorageRecord<Payload>;
        }
      },
      delete: async (id): Promise<void> => {
        deletedId = id;
      },
      clear: async (): Promise<void> => {
        cleared = true;
      },
      close: async (): Promise<void> => {
        closed = true;
      },
    };
    const manager = new StorageManager(provider);
    const record = createStorageRecord("project", { name: "Legacy orders" });

    await manager.save(record);
    expect(savedRecordIds).toEqual([record.id]);

    const scoped = await manager.findScoped({ type: "project" });
    expect(scoped).toEqual([]);
    expect(scopedCriteria).toEqual({ type: "project" });

    const streamed: StorageRecord[] = [];
    for await (const streamedRecord of manager.iterateScoped({ type: "project" })) {
      streamed.push(streamedRecord);
    }
    expect(iteratedCriteria).toEqual([{ type: "project" }]);
    expect(streamed.map((item) => item.id)).toEqual(streamedRecords.map((item) => item.id));
    expect(streamed[0]).toBe(streamedRecords[0]);
    expect(streamed[1]).toBe(streamedRecords[1]);

    await manager.delete("rec-1");
    expect(deletedId).toBe("rec-1");

    await manager.clear();
    expect(cleared).toBe(true);

    await manager.close();
    expect(closed).toBe(true);
  });
});
