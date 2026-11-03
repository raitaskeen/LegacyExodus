import { describe, expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { createLegacyExodusEngine } from "@runtime/composition/services";
import { FactArray, FactStore, toFactArray } from "@shared/fact-array";
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
      appendFileSync(pathOf(store), "2\n");
      expect(() => [...list]).toThrow("holds 2 items, expected 1");
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
