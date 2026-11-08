import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FactArray, FactStore } from "@shared/fact-array";
import { readJsonDocument } from "@shared/json-document-reader";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const step of cleanup.splice(0)) step();
});

function file(content: string): string {
  const directory = mkdtempSync(join(tmpdir(), "lx-json-doc-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "doc.json");
  writeFileSync(path, content);
  return path;
}

const lists = (keys: readonly string[]) => new Map(keys.map((key) => [key, (item: unknown) => item] as const));

function store(): FactStore {
  const facts = FactStore.create();
  cleanup.push(() => facts.dispose());
  return facts;
}

/** ADR-011: a verified artifact is restored one list item at a time, into the same values JSON.parse gives. */
describe("readJsonDocument", () => {
  const document = {
    projectId: "p",
    calls: [{ id: "a", name: "x[0], {y}", location: { line: 1 } }, { id: "b\"]}", nested: [[1, 2], { k: [] }] }],
    empty: [],
    scopes: [],
    deadCode: [{ id: "d" }],
    note: "a, b } ] \\ \" [ {",
    count: 3,
    flag: null,
  };

  it("streams the named lists to disk and parses every other member, pretty-printed or compact", () => {
    for (const text of [JSON.stringify(document, null, 2), JSON.stringify(document)]) {
      const result = readJsonDocument(file(text), store(), lists(["calls", "scopes", "missing"]));
      expect(result.calls).toBeInstanceOf(FactArray);
      expect(result.scopes).toBeInstanceOf(FactArray);
      expect(result.deadCode).not.toBeInstanceOf(FactArray);
      expect(JSON.parse(JSON.stringify(result))).toEqual(document);
    }
  });

  it("reads items that cross chunk boundaries", () => {
    const calls = Array.from({ length: 3000 }, (_, index) => ({ id: `c${index}`, text: "é—".repeat(index % 400) }));
    const result = readJsonDocument(file(JSON.stringify({ calls, tail: "end" }, null, 2)), store(), lists(["calls"]));
    expect([...(result.calls as FactArray<unknown>)]).toEqual(calls);
    expect(result.tail).toBe("end");
  });

  it("validates each item before writing it, and writes what the validator returns", () => {
    const path = file(JSON.stringify({ calls: [{ id: "a", extra: 1 }, { id: "b" }] }));
    const strip = new Map([["calls", (item: unknown) => ({ id: (item as { id: string }).id })]]);
    expect([...(readJsonDocument(path, store(), strip).calls as FactArray<unknown>)]).toEqual([{ id: "a" }, { id: "b" }]);
    const refuse = new Map([["calls", (item: unknown) => { if ((item as { id: string }).id === "b") throw new Error("invalid"); return item; }]]);
    expect(() => readJsonDocument(path, store(), refuse)).toThrow("invalid");
  });

  it("refuses what is not one well-formed JSON object", () => {
    for (const text of ["[1, 2]", "{\"calls\": [1, 2}", "{\"calls\": [1,, 2]}", "{\"a\": 1} {}", "{\"a\": \"open}", "", "{\"a\": 1,}", "{\"calls\": [1,]}"]) {
      expect(() => readJsonDocument(file(text), store(), lists(["calls"]))).toThrow();
    }
  });
});
