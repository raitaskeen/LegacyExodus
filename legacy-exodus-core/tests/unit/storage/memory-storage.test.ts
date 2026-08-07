import { describe, expect, test } from "bun:test";

import {
  createStorageRecord,
  MemoryStorageProvider,
} from "@storage/index";

describe("MemoryStorageProvider", () => {
  test("preserves insertion order and returns defensive copies", async (): Promise<void> => {
    const provider = new MemoryStorageProvider();
    const firstRecord = createStorageRecord("source-file", { path: "first.php" });
    const secondRecord = createStorageRecord("source-file", { path: "second.php" });

    await provider.save(firstRecord);
    await provider.save(secondRecord);

    const records = await provider.findAll<{ path: string }>("source-file");
    const firstRetrievedRecord = await provider.findById<{ path: string }>(firstRecord.id);

    expect(records.map((record) => record.id)).toEqual([firstRecord.id, secondRecord.id]);
    expect(firstRetrievedRecord).not.toBe(firstRecord);
    expect(firstRetrievedRecord?.payload).not.toBe(firstRecord.payload);
  });

  test("deletes records and clears all stored records", async (): Promise<void> => {
    const provider = new MemoryStorageProvider();
    const firstRecord = createStorageRecord("artifact", { name: "first" });
    const secondRecord = createStorageRecord("artifact", { name: "second" });

    await provider.save(firstRecord);
    await provider.save(secondRecord);
    await provider.delete(firstRecord.id);

    expect(await provider.findById(firstRecord.id)).toBeNull();

    await provider.clear();

    expect(await provider.findAll("artifact")).toEqual([]);
  });
});
