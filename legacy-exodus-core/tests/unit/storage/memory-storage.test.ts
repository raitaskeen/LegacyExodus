import { describe, expect, test } from "bun:test";

import {
  createStorageRecord,
  MemoryStorageProvider,
} from "@storage/index";

describe("MemoryStorageProvider", () => {
  test("preserves insertion order and returns immutable records directly without redundant cloning", async (): Promise<void> => {
    const provider = new MemoryStorageProvider();
    const firstRecord = createStorageRecord("source-file", { path: "first.php" });
    const secondRecord = createStorageRecord("source-file", { path: "second.php" });

    await provider.save(firstRecord);
    await provider.save(secondRecord);

    const records = await provider.findAll<{ path: string }>("source-file");
    const firstRetrievedRecord = await provider.findById<{ path: string }>(firstRecord.id);

    expect(records.map((record) => record.id)).toEqual([firstRecord.id, secondRecord.id]);
    expect(firstRetrievedRecord).toBe(firstRecord);
    expect(firstRetrievedRecord?.payload).toBe(firstRecord.payload);
    expect(Object.isFrozen(firstRetrievedRecord)).toBe(true);
    expect(Object.isFrozen(firstRetrievedRecord?.payload)).toBe(true);
  });

  test("P0.2: guarantees stored records and nested payloads are deeply immutable against caller mutation", async (): Promise<void> => {
    const provider = new MemoryStorageProvider();
    const rawInput = {
      module: "auth",
      nested: {
        roles: ["admin", "user"],
        config: { enabled: true },
      },
    };
    const record = createStorageRecord("nested-module", rawInput);

    // Mutating raw input object after creation does not affect the storage record
    rawInput.nested.roles.push("attacker");
    rawInput.nested.config.enabled = false;
    expect((record.payload as any).nested.roles).toEqual(["admin", "user"]);
    expect((record.payload as any).nested.config.enabled).toBe(true);

    await provider.save(record);
    const retrieved = await provider.findById<typeof rawInput>(record.id);
    expect(retrieved).not.toBeNull();
    if (!retrieved) return;

    // Verify deep runtime immutability on retrieved record
    expect(Object.isFrozen(retrieved)).toBe(true);
    expect(Object.isFrozen(retrieved.payload)).toBe(true);
    expect(Object.isFrozen(retrieved.payload.nested)).toBe(true);
    expect(Object.isFrozen(retrieved.payload.nested.roles)).toBe(true);
    expect(Object.isFrozen(retrieved.payload.nested.config)).toBe(true);

    // Top-level mutation attempt throws in strict mode
    expect(() => {
      (retrieved as any).type = "mutated";
    }).toThrow();

    // Nested object mutation attempt throws
    expect(() => {
      (retrieved.payload.nested.config as any).enabled = false;
    }).toThrow();

    // Nested array mutation attempt throws
    expect(() => {
      (retrieved.payload.nested.roles as any).push("mutated");
    }).toThrow();

    // Stored record remains intact
    const verifyAgain = await provider.findById<typeof rawInput>(record.id);
    expect(verifyAgain?.payload.nested.roles).toEqual(["admin", "user"]);
    expect(verifyAgain?.payload.nested.config.enabled).toBe(true);
  });

  test("P0.2: findAll returns immutable records and prevents mutation across subsequent reads", async (): Promise<void> => {
    const provider = new MemoryStorageProvider();
    const rec1 = createStorageRecord("graph-node", { id: "n1", edges: ["e1", "e2"] });
    const rec2 = createStorageRecord("graph-node", { id: "n2", edges: ["e3"] });

    await provider.save(rec1);
    await provider.save(rec2);

    const all = await provider.findAll<{ id: string; edges: string[] }>("graph-node");
    expect(all).toHaveLength(2);

    // Attempting to mutate an element from findAll throws
    expect(() => {
      (all[0]!.payload.edges as string[]).push("e_injected");
    }).toThrow();

    // Subsequent findAll returns the unchanged data
    const allAfter = await provider.findAll<{ id: string; edges: string[] }>("graph-node");
    expect(allAfter[0]!.payload.edges).toEqual(["e1", "e2"]);
    expect(allAfter[1]!.payload.edges).toEqual(["e3"]);
  });

  test("P0.2: enforces strict isolation between multiple distinct records", async (): Promise<void> => {
    const provider = new MemoryStorageProvider();
    const recordA = createStorageRecord("repo-state", { repo: "A", items: [1, 2] });
    const recordB = createStorageRecord("repo-state", { repo: "B", items: [3, 4] });

    await provider.save(recordA);
    await provider.save(recordB);

    const retrievedA = await provider.findById<{ repo: string; items: number[] }>(recordA.id);
    const retrievedB = await provider.findById<{ repo: string; items: number[] }>(recordB.id);

    expect(retrievedA?.payload.repo).toBe("A");
    expect(retrievedA?.payload.items).toEqual([1, 2]);
    expect(retrievedB?.payload.repo).toBe("B");
    expect(retrievedB?.payload.items).toEqual([3, 4]);
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

  test("clears transient records when the provider is closed", async (): Promise<void> => {
    const provider = new MemoryStorageProvider();
    const record = createStorageRecord("analysis-run", { projectId: "project-1" });
    await provider.save(record);

    await provider.close();

    expect(await provider.findAll("analysis-run")).toEqual([]);
  });

  test("closes safely when storage is already empty", async (): Promise<void> => {
    const provider = new MemoryStorageProvider();

    await provider.clear();
    await provider.close();
    await provider.close();

    expect(await provider.findAll("analysis-run")).toEqual([]);
  });

  test("P0.4: streaming canonical hash produces deterministic content identity regardless of key order", (): void => {
    const record1 = createStorageRecord("test-type", { a: 1, b: "two", c: [true, false, null] });
    const record2 = createStorageRecord("test-type", { c: [true, false, null], b: "two", a: 1 });

    expect(record1.id).toBe(record2.id);
    expect(record1.id).toMatch(/^[a-f0-9]{64}$/);
  });

  test("P0.4: streaming canonical hash distinguishes array ordering and primitive types", (): void => {
    const recordA = createStorageRecord("test-type", { items: [1, 2, 3] });
    const recordB = createStorageRecord("test-type", { items: [3, 2, 1] });
    const recordC = createStorageRecord("test-type", { items: ["1", "2", "3"] });

    expect(recordA.id).not.toBe(recordB.id);
    expect(recordA.id).not.toBe(recordC.id);
  });

  test("P0.4: streaming canonical hash deterministically hashes complex nested graph structures", (): void => {
    const cfgPayload1 = {
      projectId: "00000000-0000-4000-8000-000000000001",
      analysisRunId: "run-1",
      graphs: [
        {
          id: "cfg-1",
          scopeName: "main",
          blocks: [{ id: "b1", statements: [{ id: "s1", type: "ReturnStatement" }] }],
          edges: [{ id: "e1", fromBlockId: "b1", toBlockId: "b2", kind: "next" }],
          dominators: [{ blockId: "b1" }],
        },
      ],
    };
    const cfgPayload2 = {
      analysisRunId: "run-1",
      projectId: "00000000-0000-4000-8000-000000000001",
      graphs: [
        {
          dominators: [{ blockId: "b1" }],
          id: "cfg-1",
          scopeName: "main",
          edges: [{ kind: "next", fromBlockId: "b1", toBlockId: "b2", id: "e1" }],
          blocks: [{ statements: [{ type: "ReturnStatement", id: "s1" }], id: "b1" }],
        },
      ],
    };

    const rec1 = createStorageRecord("control-flow-analysis", cfgPayload1);
    const rec2 = createStorageRecord("control-flow-analysis", cfgPayload2);

    expect(rec1.id).toBe(rec2.id);
  });
});
