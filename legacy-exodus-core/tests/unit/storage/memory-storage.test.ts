import { describe, expect, test } from "bun:test";

import {
  createStorageRecord,
  MemoryStorageProvider,
  SqliteStorageProvider,
  StorageValidationError,
  validateStorageRecord,
  type StorageProvider,
  type StorageRecord,
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

describe("F06: commitBatch atomicity", () => {
  const projectId = "f06-project";
  const timestamp = new Date("2026-09-30T00:00:00.000Z");

  function domainRecord(id: string, version = 1): StorageRecord {
    return validateStorageRecord({
      id: id.repeat(64),
      type: "f06-record",
      payload: { projectId, analysisRunId: "f06-run", path: "src/f06.js", version },
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  function eventRecord(sequence: number, aggregateId = projectId): StorageRecord {
    return validateStorageRecord({
      ...createStorageRecord("domain-event", { projectId: aggregateId, sequence }),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  async function observableState(provider: StorageProvider, ids: readonly string[]) {
    const queries = [
      { type: "f06-record", projectId, analysisRunId: "f06-run", filePath: "src/f06.js" },
      { type: "domain-event", projectId },
    ];
    const iterated: StorageRecord[][] = [];
    for (const query of queries) {
      const records: StorageRecord[] = [];
      for await (const record of provider.iterateScoped(query)) {
        records.push(record);
      }
      iterated.push(records);
    }
    return {
      byId: await Promise.all(ids.map((id) => provider.findById(id))),
      all: await Promise.all(queries.map(({ type }) => provider.findAll(type))),
      scoped: await Promise.all(queries.map((query) => provider.findScoped(query))),
      iterated,
    };
  }

  for (const invalidIndex of [0, 1, 2]) {
    test(`T1/R1-R3: rejects invalid domain record at index ${invalidIndex} without publishing any batch record`, async (): Promise<void> => {
      const provider = new MemoryStorageProvider();
      const records = [domainRecord("a"), domainRecord("b"), domainRecord("c")];
      const invalid = { ...records[invalidIndex]!, type: "" };
      const ids = records.map((record) => record.id);
      const before = await observableState(provider, ids);
      records[invalidIndex] = invalid;

      await expect(provider.commitBatch({ records })).rejects.toBeInstanceOf(StorageValidationError);

      expect(await observableState(provider, ids)).toEqual(before);
      expect(await provider.findById(records[0]!.id)).toBeNull();
      expect(await provider.findAll("f06-record")).toEqual([]);
    });
  }

  test("T2/R6: preserves the old payload and unrelated state after a failed overwrite", async (): Promise<void> => {
    const provider = new MemoryStorageProvider();
    const original = domainRecord("a", 1);
    const unrelated = domainRecord("f", 99);
    const existingEvent = eventRecord(4);
    const replacement = domainRecord("a", 2);
    const invalid = { ...domainRecord("b"), type: "" };
    await provider.saveBatch([original, unrelated, existingEvent]);
    const ids = [original.id, unrelated.id, existingEvent.id, invalid.id];
    const before = await observableState(provider, ids);

    await expect(provider.commitBatch({ records: [replacement, invalid] })).rejects.toBeInstanceOf(StorageValidationError);

    expect((await provider.findById<{ version: number }>(original.id))?.payload.version).toBe(1);
    expect(await provider.findById(original.id)).toBe(original);
    expect(await observableState(provider, ids)).toEqual(before);
  });

  for (const invalidIndex of [0, 1]) {
    test(`T3/R4-R5: invalid durable event at index ${invalidIndex} leaves domain and journal state unchanged`, async (): Promise<void> => {
      const provider = new MemoryStorageProvider();
      const domain = domainRecord("a");
      const generated = [eventRecord(0), eventRecord(1)];
      const ids = [domain.id, ...generated.map((record) => record.id)];
      const before = await observableState(provider, ids);
      const sequences: number[] = [];

      await expect(provider.commitBatch({
        records: [domain],
        events: generated.map((record, index) => ({
          aggregateId: projectId,
          createRecord: (sequence: number) => {
            sequences.push(sequence);
            return index === invalidIndex ? { ...record, type: "" } : record;
          },
        })),
      })).rejects.toBeInstanceOf(StorageValidationError);

      expect(sequences).toEqual([0, 1]);
      expect(await observableState(provider, ids)).toEqual(before);
      expect(await provider.findById(domain.id)).toBeNull();
      expect(await provider.findAll("domain-event")).toEqual([]);
    });
  }

  test("T4: preserves validation type, code, message and issue details", async (): Promise<void> => {
    const provider = new MemoryStorageProvider();
    const invalid = { ...domainRecord("b"), type: "" };
    let expectedError: unknown;
    try {
      validateStorageRecord(invalid);
    } catch (error: unknown) {
      expectedError = error;
    }
    if (!(expectedError instanceof StorageValidationError)) {
      throw new Error("Expected the fixture to fail storage validation.");
    }
    expect(expectedError.metadata.issues).toEqual([
      expect.objectContaining({ code: "too_small", path: ["type"], minimum: 1 }),
    ]);

    await expect(provider.commitBatch({ records: [invalid] })).rejects.toMatchObject({
      name: "StorageValidationError",
      code: "STORAGE_RECORD_INVALID",
      message: "Storage record is invalid.",
      metadata: expectedError.metadata,
    });
    await expect(provider.commitBatch({ records: [invalid] })).rejects.toBeInstanceOf(StorageValidationError);
  });

  test("T5/R8/R13: preserves mixed-batch factory order, aggregate maxima, event order and immutable references", async (): Promise<void> => {
    const provider = new MemoryStorageProvider();
    const otherAggregate = "f06-other-project";
    await provider.saveBatch([eventRecord(4), eventRecord(1), eventRecord(12, otherAggregate)]);
    const domain = domainRecord("a");
    const generated: StorageRecord[] = [];
    const calls: { aggregateId: string; sequence: number }[] = [];
    const aggregateIds = [projectId, otherAggregate, projectId];

    const returned = await provider.commitBatch({
      records: [domain],
      events: aggregateIds.map((aggregateId) => ({
        aggregateId,
        createRecord: (sequence: number) => {
          calls.push({ aggregateId, sequence });
          const record = eventRecord(sequence, aggregateId);
          generated.push(record);
          return record;
        },
      })),
    });

    expect(calls).toEqual([
      { aggregateId: projectId, sequence: 5 },
      { aggregateId: otherAggregate, sequence: 13 },
      { aggregateId: projectId, sequence: 6 },
    ]);
    expect(await provider.findById(domain.id)).toBe(domain);
    expect(returned).toEqual(generated);
    expect(returned).toHaveLength(3);
    for (const [index, record] of generated.entries()) {
      expect(returned[index]).toBe(record);
      expect(await provider.findById(record.id)).toBe(record);
      expect(Object.isFrozen(record)).toBe(true);
      expect(Object.isFrozen(record.payload)).toBe(true);
    }
    expect((await provider.findAll("domain-event")).slice(-3)).toEqual(generated);
  });

  test("T6/R9: preserves a later factory error's identity and publishes no domain or event records", async (): Promise<void> => {
    const provider = new MemoryStorageProvider();
    const domain = domainRecord("a");
    const generated = eventRecord(0);
    const sentinel = new Error("factory failed");
    const before = await observableState(provider, [domain.id, generated.id]);

    await expect(provider.commitBatch({
      records: [domain],
      events: [
        { aggregateId: projectId, createRecord: () => generated },
        { aggregateId: projectId, createRecord: () => { throw sentinel; } },
      ],
    })).rejects.toBe(sentinel);

    expect(await provider.findById(domain.id)).toBeNull();
    expect(await observableState(provider, [domain.id, generated.id])).toEqual(before);
  });

  test("preserves generation-before-validation and domain-before-event validation order", async (): Promise<void> => {
    const provider = new MemoryStorageProvider();
    const firstInvalid = { ...domainRecord("a"), id: "invalid-id" };
    const laterInvalid = { ...domainRecord("b"), type: "" };
    const calls: number[] = [];

    await expect(provider.commitBatch({
      records: [firstInvalid, laterInvalid],
      events: [0, 1].map((index) => ({
        aggregateId: projectId,
        createRecord: (sequence: number) => {
          calls.push(index);
          return { ...eventRecord(sequence), type: "" };
        },
      })),
    })).rejects.toMatchObject({
      metadata: { issues: [expect.objectContaining({ path: ["id"] })] },
    });
    expect(calls).toEqual([0, 1]);
    expect(await provider.findAll("domain-event")).toEqual([]);
  });

  test("R7: later duplicate IDs and successful overwrites win without changing insertion order", async (): Promise<void> => {
    const provider = new MemoryStorageProvider();
    const original = domainRecord("a", 1);
    const replacement = domainRecord("a", 2);
    const last = domainRecord("a", 3);
    const second = domainRecord("b");
    await provider.save(original);

    expect(await provider.commitBatch({ records: [replacement, second, last] })).toEqual([]);
    expect(await provider.findAll("f06-record")).toEqual([last, second]);
    expect(await provider.findById(original.id)).toBe(last);

    const durable = validateStorageRecord({ ...eventRecord(0), id: second.id });
    expect(await provider.commitBatch({
      records: [second],
      events: [{ aggregateId: projectId, createRecord: () => durable }],
    })).toEqual([durable]);
    expect(await provider.findById(second.id)).toBe(durable);
    expect(await provider.findAll("f06-record")).toEqual([last]);
  });

  test("returns original factory records while storing validated immutable references", async (): Promise<void> => {
    const provider = new MemoryStorageProvider();
    const raw = { ...eventRecord(0), payload: { projectId, sequence: 0 } };
    const returned = await provider.commitBatch({
      records: [],
      events: [{ aggregateId: projectId, createRecord: () => raw }],
    });
    const stored = await provider.findById(raw.id);

    expect(returned[0]).toBe(raw);
    expect(stored).toEqual(raw);
    expect(stored).not.toBe(raw);
    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(stored?.payload)).toBe(true);
  });

  test("R10: an empty batch is a no-op returning an empty array", async (): Promise<void> => {
    const provider = new MemoryStorageProvider();
    const existing = domainRecord("a");
    await provider.save(existing);
    const before = await observableState(provider, [existing.id]);

    expect(await provider.commitBatch({ records: [], events: [] })).toEqual([]);
    expect(await observableState(provider, [existing.id])).toEqual(before);
  });

  test("R11: a records-only batch publishes records in array order", async (): Promise<void> => {
    const provider = new MemoryStorageProvider();
    const records = [domainRecord("a"), domainRecord("b")];

    expect(await provider.commitBatch({ records })).toEqual([]);
    expect(await provider.findAll("f06-record")).toEqual(records);
  });

  test("R12: an events-only batch begins at zero and increases within the aggregate", async (): Promise<void> => {
    const provider = new MemoryStorageProvider();
    const returned = await provider.commitBatch({
      records: [],
      events: [0, 1].map(() => ({ aggregateId: projectId, createRecord: eventRecord })),
    });

    expect(returned.map((record) => record.payload)).toEqual([
      { projectId, sequence: 0 },
      { projectId, sequence: 1 },
    ]);
    expect(await provider.findAll("domain-event")).toEqual([...returned]);
  });

  for (const Provider of [MemoryStorageProvider, SqliteStorageProvider]) {
    for (const failure of ["domain", "event"]) {
      test(`R14 parity: ${Provider.name} preserves pre-batch state on later ${failure} validation failure`, async (): Promise<void> => {
        const provider = new Provider();
        try {
          const original = domainRecord("a", 1);
          const unrelated = domainRecord("f", 99);
          const existingEvent = eventRecord(4);
          await provider.saveBatch([original, unrelated, existingEvent]);
          const replacement = domainRecord("a", 2);
          const added = domainRecord("b");
          const invalid = { ...domainRecord("c"), type: "" };
          const events = [eventRecord(5), { ...eventRecord(6), type: "" }];
          const ids = [original.id, unrelated.id, added.id, invalid.id, existingEvent.id, ...events.map((record) => record.id)];
          const before = await observableState(provider, ids);

          await expect(provider.commitBatch({
            records: failure === "domain" ? [replacement, added, invalid] : [replacement, added],
            events: failure === "event" ? events.map((record) => ({
              aggregateId: projectId,
              createRecord: () => record,
            })) : [],
          })).rejects.toBeInstanceOf(StorageValidationError);

          expect((await provider.findById<{ version: number }>(original.id))?.payload.version).toBe(1);
          expect(await observableState(provider, ids)).toEqual(before);
        } finally {
          await provider.close();
        }
      });
    }
  }
});
