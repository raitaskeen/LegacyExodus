import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { diffFacts, extractFacts, formatFactDiff } from "../../../benchmarks/fact-diff";

const directories: string[] = [];

function discovery(artifacts: Record<string, unknown>): string {
  const directory = mkdtempSync(join(tmpdir(), "lx-fact-diff-test-"));
  directories.push(directory);
  for (const [name, value] of Object.entries(artifacts)) writeFileSync(join(directory, name), JSON.stringify(value));
  return directory;
}

const symbolA = { id: "a".repeat(64), kind: "function", name: "a", filePath: "lib.js", exported: true, location: { start: { line: 1, column: 0 }, end: { line: 1, column: 9 } } };
const symbolB = { id: "b".repeat(64), kind: "function", name: "b", filePath: "lib.js", exported: true, location: { start: { line: 2, column: 0 }, end: { line: 2, column: 9 } } };
const call = (state: string, target?: string) => ({ id: "c".repeat(64), sourceFilePath: "main.js", callerName: "module", calleeName: "b", resolutionState: state, location: { line: 3, column: 0 }, ...(target === undefined ? {} : { targetSymbolId: target }) });

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("fact diff", () => {
  it("ignores artifact order and volatile fields", () => {
    const base = discovery({
      "symbols.json": [symbolA, symbolB],
      "summary.json": { generatedAt: "2026-01-01", analysisDisposition: { files: [{ path: "lib.js", kind: "analyzed" }, { path: "main.js", kind: "analyzed" }] } },
    });
    const head = discovery({
      "symbols.json": [symbolB, symbolA],
      "summary.json": { generatedAt: "2026-12-31", analysisDisposition: { files: [{ path: "main.js", kind: "analyzed" }, { path: "lib.js", kind: "analyzed" }] } },
    });

    const diff = diffFacts(extractFacts(base), extractFacts(head));

    expect(diff.lost).toBe(0);
    expect(diff.gained).toBe(0);
  });

  it("reports a call that stops resolving as one lost and one gained fact, rendered through the symbol table", () => {
    const base = discovery({ "symbols.json": [symbolA, symbolB], "semantic.json": { calls: [call("RESOLVED", symbolB.id)] } });
    const head = discovery({ "symbols.json": [symbolA, symbolB], "semantic.json": { calls: [call("UNRESOLVED")] } });

    const diff = diffFacts(extractFacts(base), extractFacts(head));
    const calls = diff.categories.find((category) => category.category === "calls");

    expect(calls?.lost).toEqual(["main.js@3:0|module|b|RESOLVED|function:b@2:0@lib.js"]);
    expect(calls?.gained).toEqual(["main.js@3:0|module|b|UNRESOLVED|-"]);
    expect(formatFactDiff([{ corpus: "sample", baseMs: 10, headMs: 12, ...diff }])).toContain("| calls | 1 | 1 | 1 | 1 |");
  });

  it("counts repeated identical references instead of collapsing them", () => {
    const reference = { id: "r", filePath: "main.js", name: "b", kind: "identifier", resolutionState: "RESOLVED", resolvedSymbolId: symbolB.id };
    const base = discovery({ "symbols.json": [symbolB], "semantic.json": { references: [reference, { ...reference, id: "s" }] } });
    const head = discovery({ "symbols.json": [symbolB], "semantic.json": { references: [reference] } });

    const references = diffFacts(extractFacts(base), extractFacts(head)).categories.find((category) => category.category === "references");

    expect(references?.lost).toEqual(["main.js|identifier|b|RESOLVED|function:b@2:0@lib.js ×2"]);
    expect(references?.gained).toEqual(["main.js|identifier|b|RESOLVED|function:b@2:0@lib.js"]);
  });
});
