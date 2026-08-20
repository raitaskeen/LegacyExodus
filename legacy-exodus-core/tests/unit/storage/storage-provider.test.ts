import { describe, expect, test } from "bun:test";

import {
  createStorageRecord,
  type StorageProvider,
} from "@storage/index";
import { MemoryStorageProvider } from "@storage/adapters/memory-storage";

describe("StorageProvider contract", () => {
  test("supports saving and retrieving a typed storage record", async (): Promise<void> => {
    const provider: StorageProvider = new MemoryStorageProvider();
    const record = createStorageRecord("project", { name: "Legacy payroll" });

    await provider.save(record);

    const storedRecord = await provider.findById<{ name: string }>(record.id);

    expect(storedRecord).toEqual(record);
  });

  test("uses canonical content identities independent of runtime metadata", (): void => {
    const first = createStorageRecord("project", { nested: { b: 2, a: 1 } });
    const second = createStorageRecord("project", { nested: { a: 1, b: 2 } });
    const differentPayload = createStorageRecord("project", { nested: { a: 1, b: 3 } });
    const differentType = createStorageRecord("artifact", { nested: { a: 1, b: 2 } });

    expect(first.id).toBe(second.id);
    expect(first.id).not.toBe(differentPayload.id);
    expect(first.id).not.toBe(differentType.id);
    expect(first.createdAt).not.toBe(first.updatedAt);
  });
});
