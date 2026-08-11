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
});
