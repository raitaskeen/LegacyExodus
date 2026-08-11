import { describe, expect, test } from "bun:test";

import {
  createStorageRecord,
  StorageManager,
  type StorageProvider,
} from "@storage/index";

describe("StorageManager", () => {
  test("delegates operations to its injected storage provider", async (): Promise<void> => {
    const savedRecordIds: string[] = [];
    const provider: StorageProvider = {
      save: async (record): Promise<void> => {
        savedRecordIds.push(record.id);
      },
      findById: async (): Promise<null> => null,
      findAll: async (): Promise<[]> => [],
      delete: async (): Promise<void> => undefined,
      clear: async (): Promise<void> => undefined,
    };
    const manager = new StorageManager(provider);
    const record = createStorageRecord("project", { name: "Legacy orders" });

    await manager.save(record);

    expect(savedRecordIds).toEqual([record.id]);
  });
});
