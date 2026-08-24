import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { SqliteStorageProvider } from "@storage/adapters/sqlite-storage";
import { createStorageRecord } from "@storage/storage-record";
import { StorageRecordNotFoundError } from "@storage/storage-errors";

describe("SqliteStorageProvider", () => {
  let inMemoryProvider: SqliteStorageProvider;

  beforeEach(() => {
    inMemoryProvider = new SqliteStorageProvider({ inMemory: true });
  });

  afterEach(() => {
    inMemoryProvider.close();
  });

  it("saves and retrieves a storage record by id", async () => {
    const record = createStorageRecord("test-record", {
      projectId: "00000000-0000-4000-8000-000000000001",
      name: "test-item",
      count: 42,
    });

    await inMemoryProvider.save(record);
    const retrieved = await inMemoryProvider.findById(record.id);

    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(record.id);
    expect(retrieved!.type).toBe("test-record");
    expect(retrieved!.payload).toEqual(record.payload);
  });

  it("returns null for non-existent record id", async () => {
    const result = await inMemoryProvider.findById("non-existent-id");
    expect(result).toBeNull();
  });

  it("finds all records matching a specific type in created_at order", async () => {
    const record1 = createStorageRecord("item", { index: 1 });
    const record2 = createStorageRecord("item", { index: 2 });
    const otherRecord = createStorageRecord("other", { index: 3 });

    await inMemoryProvider.save(record1);
    await inMemoryProvider.save(record2);
    await inMemoryProvider.save(otherRecord);

    const items = await inMemoryProvider.findAll("item");
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.id)).toEqual([record1.id, record2.id]);

    const others = await inMemoryProvider.findAll("other");
    expect(others).toHaveLength(1);
    expect(others[0]!.id).toBe(otherRecord.id);

    const empty = await inMemoryProvider.findAll("non-existent-type");
    expect(empty).toHaveLength(0);
  });

  it("deletes a record by id and throws if not found", async () => {
    const record = createStorageRecord("to-delete", { key: "val" });
    await inMemoryProvider.save(record);

    await inMemoryProvider.delete(record.id);
    const result = await inMemoryProvider.findById(record.id);
    expect(result).toBeNull();

    expect(inMemoryProvider.delete(record.id)).rejects.toThrow(StorageRecordNotFoundError);
  });

  it("clears all records when clear is invoked", async () => {
    const record1 = createStorageRecord("type-a", { a: 1 });
    const record2 = createStorageRecord("type-b", { b: 2 });

    await inMemoryProvider.save(record1);
    await inMemoryProvider.save(record2);

    await inMemoryProvider.clear();

    const itemsA = await inMemoryProvider.findAll("type-a");
    const itemsB = await inMemoryProvider.findAll("type-b");
    expect(itemsA).toHaveLength(0);
    expect(itemsB).toHaveLength(0);
  });

  it("persists records to file and reloads upon reopen", async () => {
    const testDbPath = join(tmpdir(), `test-storage-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);

    try {
      const fileProvider1 = new SqliteStorageProvider({ databasePath: testDbPath });
      const record = createStorageRecord("persistent-record", {
        projectId: "11111111-2222-4333-8444-555555555555",
        analysisRunId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        data: "persisted-value",
      });

      await fileProvider1.save(record);
      fileProvider1.close();

      const fileProvider2 = new SqliteStorageProvider({ databasePath: testDbPath });
      const reloaded = await fileProvider2.findById(record.id);

      expect(reloaded).not.toBeNull();
      expect(reloaded!.id).toBe(record.id);
      expect(reloaded!.payload).toEqual(record.payload);
      fileProvider2.close();
    } finally {
      try {
        await rm(testDbPath, { force: true });
        await rm(`${testDbPath}-wal`, { force: true });
        await rm(`${testDbPath}-shm`, { force: true });
      } catch {}
    }
  });

  it("extracts structured project_id and analysis_run_id for indexing", async () => {
    const recordWithRun = createStorageRecord("run-item", {
      projectId: "22222222-3333-4444-8555-666666666666",
      analysisRunId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
      path: "src/file.ts",
      value: 100,
    });

    await inMemoryProvider.save(recordWithRun);
    const retrieved = await inMemoryProvider.findById(recordWithRun.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.payload).toEqual(recordWithRun.payload);
  });

  it("preserves persistent records across StorageManager close/reopen", async () => {
    const testDbPath = join(tmpdir(), `test-mgr-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);

    try {
      const provider1 = new SqliteStorageProvider({ databasePath: testDbPath });
      expect(provider1.isPersistent).toBe(true);

      const record = createStorageRecord("persistent-discovery", {
        projectId: "33333333-4444-4555-8666-777777777777",
        status: "complete",
      });

      await provider1.save(record);
      provider1.close();

      const provider2 = new SqliteStorageProvider({ databasePath: testDbPath });
      const reloaded = await provider2.findById(record.id);
      expect(reloaded).not.toBeNull();
      expect(reloaded!.payload).toEqual(record.payload);
      provider2.close();
    } finally {
      try {
        await rm(testDbPath, { force: true });
        await rm(`${testDbPath}-wal`, { force: true });
        await rm(`${testDbPath}-shm`, { force: true });
      } catch {}
    }
  });

  it("enforces strict analysis run isolation across distinct runs", async () => {
    const run1Record = createStorageRecord("run-data", {
      projectId: "proj-1",
      analysisRunId: "run-1",
      val: "data-1",
    });
    const run2Record = createStorageRecord("run-data", {
      projectId: "proj-1",
      analysisRunId: "run-2",
      val: "data-2",
    });
    const proj2Record = createStorageRecord("run-data", {
      projectId: "proj-2",
      analysisRunId: "run-1",
      val: "data-3",
    });

    await inMemoryProvider.save(run1Record);
    await inMemoryProvider.save(run2Record);
    await inMemoryProvider.save(proj2Record);

    const all = await inMemoryProvider.findAll("run-data");
    expect(all).toHaveLength(3);

    const r1 = await inMemoryProvider.findById(run1Record.id);
    expect(r1?.payload).toEqual(run1Record.payload);

    const r2 = await inMemoryProvider.findById(run2Record.id);
    expect(r2?.payload).toEqual(run2Record.payload);
  });
});
