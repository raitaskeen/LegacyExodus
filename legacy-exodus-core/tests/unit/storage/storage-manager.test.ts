import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createStorageRecord,
  SqliteStorageProvider,
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
    let clearCalls = 0;
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
        clearCalls++;
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

    await manager.clearTransient();
    expect(clearCalls).toBe(1);

    await manager.clear();
    expect(clearCalls).toBe(2);

    await manager.close();
    expect(closed).toBe(true);
  });

  test("does not clear a provider that declares persistent storage", async (): Promise<void> => {
    let clearCalls = 0;
    const provider: StorageProvider = {
      isPersistent: true,
      save: async (): Promise<void> => {},
      findById: async (): Promise<null> => null,
      findAll: async (): Promise<[]> => [],
      findScoped: async (): Promise<[]> => [],
      iterateScoped: async function* <Payload extends SerializedPayload>(): AsyncIterable<StorageRecord<Payload>> {},
      delete: async (): Promise<void> => {},
      clear: async (): Promise<void> => {
        clearCalls++;
      },
    };
    const manager = new StorageManager(provider);

    await manager.clearTransient();

    expect(clearCalls).toBe(0);
  });

  test("preserves representative records in persistent SQLite storage", async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), "legacy-exodus-clear-transient-"));
    const databasePath = join(directory, "storage.sqlite");
    const provider = new SqliteStorageProvider({ databasePath });
    const manager = new StorageManager(provider);
    const record = createStorageRecord("analysis-run", {
      projectId: "00000000-0000-4000-8000-000000000001",
      analysisRunId: "00000000-0000-4000-8000-000000000002",
    });

    try {
      await manager.save(record);
      await manager.clearTransient();

      expect(await manager.findById(record.id)).toEqual(record);
    } finally {
      await manager.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
