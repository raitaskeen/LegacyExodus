import { describe, expect, test } from "bun:test";

import {
  createStorageRecord,
  StorageManager,
  type StorageProvider,
} from "@storage/index";

describe("StorageManager", () => {
  test("delegates operations to its injected storage provider", async (): Promise<void> => {
    const savedRecordIds: string[] = [];
    let closed = false;
    let cleared = false;
    let deletedId = "";
    let scopedCriteria: any = null;

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

    await manager.delete("rec-1");
    expect(deletedId).toBe("rec-1");

    await manager.clear();
    expect(cleared).toBe(true);

    await manager.close();
    expect(closed).toBe(true);
  });
});
