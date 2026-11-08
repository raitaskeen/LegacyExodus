import { describe, expect, it } from "bun:test";
import { createOwnedStorageRecord, createStorageRecord } from "@storage/index";

describe("BA-17 owned storage records", () => {
  const payload = () => ({ projectId: "p", items: [{ id: "a", location: { line: 1, column: 0 } }, { id: "b", location: { line: 2, column: 3 } }], note: null });

  it("has the same content identity and content as a copied record", () => {
    const copied = createStorageRecord("semantic-analysis", payload());
    const owned = createOwnedStorageRecord("semantic-analysis", payload());
    expect(owned.id).toBe(copied.id);
    expect(owned.payload).toEqual(copied.payload);
  });

  it("keeps the handed-over payload instead of copying it", () => {
    const handed = payload();
    expect(createOwnedStorageRecord("semantic-analysis", handed).payload).toBe(handed);
  });

  it("freezes every nested object, also beneath a parent that was already frozen", () => {
    const handed = payload();
    Object.freeze(handed.items[0]);
    const record = createOwnedStorageRecord("semantic-analysis", handed);
    expect(Object.isFrozen(record.payload)).toBe(true);
    expect(Object.isFrozen(record.payload.items)).toBe(true);
    expect(Object.isFrozen(record.payload.items[0]!.location)).toBe(true);
    expect(Object.isFrozen(record.payload.items[1]!.location)).toBe(true);
  });
});
