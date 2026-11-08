import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { createLegacyExodusEngine } from "@runtime/composition/services";
import { FactArray, FactStore, sortedFactArray, toFactArray } from "@shared/fact-array";
import { createOwnedStorageRecord } from "@storage/storage-record";
import { StreamingJsonWriter } from "@storage/projections/streaming-json-writer";

async function written(payload: unknown): Promise<string> {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  await new StreamingJsonWriter(64).writeToStream(payload, stream);
  return Buffer.concat(chunks).toString("utf8");
}

describe("ADR-009 fact lists on disk", () => {
  test("give back the items written, in order, any number of times", () => {
    const store = FactStore.create();
    try {
      const items = [{ id: "a", n: 1 }, { id: "b", nested: { list: [1, 2, null] } }, { id: "c", text: "line\nbreak \"quoted\"" }];
      const list = toFactArray(store, items);
      expect(list.length).toBe(3);
      expect([...list]).toEqual(items);
      expect([...list]).toEqual(items);
      expect(JSON.parse(JSON.stringify({ list }))).toEqual({ list: items });
    } finally {
      store.dispose();
    }
  });

  test("decode text that spans read chunks (1 MiB) without splitting characters", () => {
    const store = FactStore.create();
    try {
      const items = Array.from({ length: 3_000 }, (_, index) => ({ index, text: `é漢字🙂${"x".repeat(index % 700)}` }));
      expect([...toFactArray(store, items)]).toEqual(items);
    } finally {
      store.dispose();
    }
  });

  test("map is a lazy view of the same items", () => {
    const store = FactStore.create();
    try {
      const list = toFactArray(store, [1, 2, 3]).map((value) => value * 10).map((value) => `#${value}`);
      expect(list.length).toBe(3);
      expect([...list]).toEqual(["#10", "#20", "#30"]);
    } finally {
      store.dispose();
    }
  });

  test("a list whose file no longer holds what was written fails loudly", () => {
    const store = FactStore.create();
    try {
      const writer = store.writer<number>();
      writer.append(1);
      const list = writer.seal();
      writeFileSync(pathOf(store), "");
      expect(() => [...list]).toThrow("holds 0 items, expected 1");
      expect(() => writer.append(3)).toThrow("sealed");
    } finally {
      store.dispose();
    }
  });

  test("dispose removes the directory, open writers included", () => {
    const store = FactStore.create();
    const directory = (store as unknown as { directory: string }).directory;
    store.writer<number>().append(1);
    toFactArray(store, [1]);
    expect(readdirSync(directory)).toHaveLength(2);
    store.dispose();
    expect(existsSync(directory)).toBe(false);
    expect(() => store.writer()).toThrow("disposed");
  });

  test("are projected byte for byte as the arrays they stand for", async () => {
    const store = FactStore.create();
    try {
      const graphs = [{ id: "g1", blocks: [{ id: "b", statements: ["s1", "s2"] }] }, { id: "g2", blocks: [] }];
      const inline = await written({ projectId: "p", graphs, other: [1, 2], empty: [] });
      const onDisk = await written({ projectId: "p", graphs: toFactArray(store, graphs), other: [1, 2], empty: toFactArray(store, []) });
      expect(onDisk).toBe(inline);
      expect(inline).toBe(`${JSON.stringify({ projectId: "p", graphs, other: [1, 2], empty: [] }, null, 2)}\n`);
    } finally {
      store.dispose();
    }
  });

  test("give records an identity from their digest, equal for equal content", () => {
    const store = FactStore.create();
    try {
      const first = createOwnedStorageRecord("control-flow-analysis", { projectId: "p", graphs: toFactArray(store, [{ id: "a" }]) });
      const same = createOwnedStorageRecord("control-flow-analysis", { projectId: "p", graphs: toFactArray(store, [{ id: "a" }]) });
      const other = createOwnedStorageRecord("control-flow-analysis", { projectId: "p", graphs: toFactArray(store, [{ id: "b" }]) });
      expect(first.id).toBe(same.id);
      expect(first.id).not.toBe(other.id);
      expect(first.payload.graphs).toBeInstanceOf(FactArray);
    } finally {
      store.dispose();
    }
  });
});

describe("ADR-009 step 2: many small lists in one file", () => {
  test("a spool keeps each list to its own range, readable while later lists are written", () => {
    const store = FactStore.create();
    try {
      const spool = store.spool();
      const first = toFactArray(spool, [{ id: "a" }, { id: "b" }]);
      expect([...first]).toEqual([{ id: "a" }, { id: "b" }]);
      const empty = toFactArray(spool, []);
      const third = toFactArray(spool, [{ id: "é漢" }]);
      spool.close();
      expect([...first]).toEqual([{ id: "a" }, { id: "b" }]);
      expect([...empty]).toEqual([]);
      expect([...third]).toEqual([{ id: "é漢" }]);
      expect(readdirSync((store as unknown as { directory: string }).directory)).toHaveLength(1);
    } finally {
      store.dispose();
    }
  });

  test("a spool writes one list at a time", () => {
    const store = FactStore.create();
    try {
      const spool = store.spool();
      const writer = spool.writer<number>();
      expect(() => spool.writer<number>()).toThrow("one list at a time");
      writer.seal();
      expect(() => spool.writer<number>().seal()).not.toThrow();
    } finally {
      store.dispose();
    }
  });

  test("concat reads lists one after another, mapped views included, and projects as one array", async () => {
    const store = FactStore.create();
    try {
      const spool = store.spool();
      const a = toFactArray(spool, [1, 2]);
      const b = toFactArray(store, [3]).map((value) => value * 10);
      const both = FactArray.concat([a, b, toFactArray(spool, [])]);
      expect(both.length).toBe(3);
      expect([...both]).toEqual([1, 2, 30]);
      expect(await written(both)).toBe(`${JSON.stringify([1, 2, 30], null, 2)}\n`);
      expect(FactArray.concat([a, b]).sha256).toBe(FactArray.concat([a, b]).sha256);
      expect(FactArray.concat([a, b]).sha256).not.toBe(FactArray.concat([b, a]).sha256);
    } finally {
      store.dispose();
    }
  });
});

describe("ADR-009 step 5: sorting in bounded memory", () => {
  test("runs merged from disk give the stable in-memory sort, ties in input order", () => {
    const store = FactStore.create();
    try {
      const items = Array.from({ length: 1_000 }, (_, index) => ({ key: `k${(index * 7919) % 97}`, index }));
      const expected = [...items].sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : left.index - right.index));
      for (const runLength of [1, 7, 100, 1_000, 5_000]) {
        expect([...sortedFactArray(store, items, (item) => item.key, runLength)]).toEqual(expected);
      }
      expect([...sortedFactArray(store, [], (item: string) => item, 3)]).toEqual([]);
    } finally {
      store.dispose();
    }
  });
});

describe("ADR-009 fact store lifetime", () => {
  test("one exit hook however many stores come and go", () => {
    FactStore.create().dispose();
    const listeners = process.listenerCount("exit");
    for (let index = 0; index < 20; index++) FactStore.create().dispose();
    expect(process.listenerCount("exit")).toBe(listeners);
  });

  test("a session reset releases past runs' fact lists", async () => {
    const project = mkdtempSync(join(tmpdir(), "lx-facts-project-"));
    writeFileSync(join(project, "a.js"), "export function f(x) { return x + 1; }\nf(1);\n");
    const engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    const stores = () => readdirSync(tmpdir()).filter((name) => name.startsWith("legacy-exodus-facts-")).length;
    try {
      await engine.initialize();
      const before = stores();
      await engine.execute({ id: "00000000-0000-4000-8000-c00000000000", type: "AnalyzeProject", createdAt: new Date("2026-01-01T00:00:00.000Z"), payload: { projectId: "00000000-0000-4000-8000-c00000000001", path: project, refresh: true } });
      expect(stores()).toBe(before + 1);
      await engine.resetSession();
      expect(stores()).toBe(before);
    } finally {
      await engine.shutdown();
      rmSync(project, { recursive: true, force: true });
    }
  });
});

function pathOf(store: FactStore): string {
  const directory = (store as unknown as { directory: string }).directory;
  return `${directory}/0.jsonl`;
}
