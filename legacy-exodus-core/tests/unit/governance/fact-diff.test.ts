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

  // Red-team counterexamples on PR #204: each of these changes must be visible as a lost fact.
  const lostIn = (base: Record<string, unknown>, head: Record<string, unknown>, category: string): readonly string[] =>
    diffFacts(extractFacts(discovery(base)), extractFacts(discovery(head))).categories.find((entry) => entry.category === category)?.lost ?? [];
  const edge = (phase: string, start: number) => ({ sourceFilePath: "use.ts", targetFilePath: "lib.ts", moduleSpecifier: "./lib", form: "esm-binding", sourcePhase: phase, sourceAnchor: { kind: "offset", start, end: start + 20 } });

  it("sees a dropped type-only module edge next to a value edge to the same file", () => {
    const lost = lostIn(
      { "dependency-graph.json": { edges: [], cycles: [], moduleGraph: { edges: [edge("type", 0), edge("value", 30)] } } },
      { "dependency-graph.json": { edges: [], cycles: [], moduleGraph: { edges: [edge("value", 30)] } } },
      "module-edges",
    );

    expect(lost).toEqual(["use.ts -> lib.ts|./lib|esm-binding|phase=type|@0-20"]);
  });

  it("sees a dropped unresolved module reference", () => {
    const unresolved = { sourceFilePath: "main.js", form: "dynamic-import", sourceAnchor: { kind: "offset", start: 0, end: 12 } };
    expect(lostIn(
      { "dependency-graph.json": { edges: [], cycles: [], moduleGraph: { edges: [], unresolvedReferences: [unresolved] } } },
      { "dependency-graph.json": { edges: [], cycles: [], moduleGraph: { edges: [] } } },
      "module-unresolved",
    )).toEqual(["main.js|dynamic-import|@0-12"]);
  });

  it("sees one of two identical routes disappear", () => {
    const route = { filePath: "app.js", method: "GET", path: "/t", handlerName: "h", middleware: [], state: "INFERRED" };

    expect(lostIn({ "semantic.json": { routes: [route, route] } }, { "semantic.json": { routes: [route] } }, "routes"))
      .toEqual(["app.js|GET /t|handler=h|middleware=[]|INFERRED ×2"]);
  });

  it("sees a symbol flag change that the summary symbol fact does not carry", () => {
    expect(lostIn({ "symbols.json": [{ ...symbolA, async: true }] }, { "symbols.json": [{ ...symbolA, async: false }] }, "symbol-details"))
      .toEqual([expect.stringContaining("|async=true|")]);
  });

  it("sees swapped CFG edge kinds and a changed taint path", () => {
    const statement = (type: string, line: number) => ({ id: `s${line}`, type, location: { line, column: 0 } });
    const cfg = (kinds: readonly [string, string]) => ({ graphs: [{
      id: "g", filePath: "a.js", scopeName: "module", state: "RESOLVED", entryBlockId: "b0", exitBlockId: "b3",
      blocks: [{ id: "b0", statements: [statement("IfStatement", 1)] }, { id: "b1", statements: [statement("ReturnStatement", 2)] }, { id: "b2", statements: [statement("ReturnStatement", 3)] }, { id: "b3", statements: [] }],
      edges: [{ id: "e1", fromBlockId: "b0", toBlockId: "b1", kind: kinds[0] }, { id: "e2", fromBlockId: "b0", toBlockId: "b2", kind: kinds[1] }],
      dominators: [], loops: [], unreachableBlockIds: [], deadCodeNodeIds: [],
    }] });
    expect(lostIn({ "control-flow.json": cfg(["true", "false"]) }, { "control-flow.json": cfg(["false", "true"]) }, "cfg-edges")).toHaveLength(2);

    const dfg = (via: readonly string[]) => ({ graphs: [{
      id: "d", filePath: "a.js", state: "INFERRED", uses: [], defUseChains: [], lifetimes: [], interproceduralFlows: [], functionSummaries: [], callBindings: [],
      definitions: [{ id: "x", filePath: "a.js", name: "x", kind: "declaration" }, { id: "y", filePath: "a.js", name: "y", kind: "declaration" }],
      taintFlows: [{ sourceId: "s".repeat(64), sinkId: "k".repeat(64), path: ["s".repeat(64), ...via, "res.send"], state: "CONFIRMED" }],
    }] });
    expect(lostIn({ "data-flow.json": dfg(["x"]) }, { "data-flow.json": dfg(["y"]) }, "taint")).toEqual([expect.stringContaining("via=[x:declaration@a.js]")]);
  });

  it("refuses an engine root that is not an engine", async () => {
    const { analyzeWith } = await import("../../../benchmarks/fact-diff");
    expect(() => analyzeWith(discovery({}), discovery({}))).toThrow("Not an engine root");
  });
});
