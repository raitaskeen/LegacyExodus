import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { DeterministicSemanticAnalysisEngine } from "@semantic/index";
import { DeterministicKnowledgeGraphBuilder } from "@knowledge/index";
import type { ASTNode } from "@parser/index";
import { DeterministicDependencyGraphBuilder } from "@graph/index";
import { JavaScriptParser } from "@parser/index";
import { JavaScriptSymbolExtractor } from "@symbols/index";

async function prepare(sources: Readonly<Record<string, string>>) {
  const parser = new JavaScriptParser();
  const extractor = new JavaScriptSymbolExtractor();
  const entries = await Promise.all(Object.entries(sources).map(async ([path, source]) => {
    const file = { id: path, path, language: "typescript", size: source.length };
    const ast = (await parser.parse({ file, source })).result;
    expect(ast.errors).toEqual([]);
    return { file, ast, table: extractor.extract(ast) };
  }));
  const files = entries.map((entry) => entry.file);
  const symbolTables = entries.map((entry) => entry.table);
  const graph = new DeterministicDependencyGraphBuilder().build(symbolTables, files);
  return { files, symbolTables, astResults: entries.map((entry) => entry.ast), graph };
}

describe("F07 direct import relationships", () => {
  test("T1 reciprocal side-effect imports retain a cycle without bindings", async () => {
    const { graph } = await prepare({
      "src/a.ts": 'import "./b"; export const a = 1;',
      "src/b.ts": 'import "./a"; export const b = 1;',
    });
    expect(graph.edges).toEqual([]);
    expect(graph.cycles).toEqual([["src/a.ts", "src/b.ts", "src/a.ts"]]);
    expect(graph).toMatchObject({ moduleGraph: { contract: "f07-import-relations-v1", edges: [expect.any(Object), expect.any(Object)] } });
  });
  test("T2 mixed bound and side-effect cycle preserves the binding", async () => {
    const { graph } = await prepare({
      "src/a.ts": 'import { b } from "./b"; export const a = b + 1;',
      "src/b.ts": 'import "./a"; export const b = 1;',
    });
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ sourceFilePath: "src/a.ts", targetFilePath: "src/b.ts" });
    expect(graph.cycles).toEqual([["src/a.ts", "src/b.ts", "src/a.ts"]]);
    expect(graph).toMatchObject({ moduleGraph: { edges: [expect.any(Object), expect.any(Object)] } });
  });
  test("T3 acyclic side-effect import retains one module relationship", async () => {
    const { graph } = await prepare({ "src/a.ts": 'import "./b";', "src/b.ts": "export const b = 1;" });
    expect(graph.edges).toEqual([]);
    expect(graph.cycles).toEqual([]);
    expect(graph).toMatchObject({ moduleGraph: { contract: "f07-import-relations-v1", edges: [{
      id: expect.any(String), sourceFilePath: "src/a.ts", targetFilePath: "src/b.ts", moduleSpecifier: "./b", form: "esm-side-effect",
    }] } });
  });
  test("T4 resolved module with missing export retains its direct relationship", async () => {
    const { graph } = await prepare({ "src/a.ts": 'import { missing } from "./b";', "src/b.ts": "export const other = 1;" });
    expect(graph.edges).toEqual([]);
    expect(graph.cycles).toEqual([]);
    expect(graph).toMatchObject({ moduleGraph: { edges: [{ sourceFilePath: "src/a.ts", targetFilePath: "src/b.ts", form: "esm-binding" }] } });
  });
});

describe("F07 bounded compatibility and provenance", () => {
  test("T5 terminal F04 bindings and calls retain the directly imported barrel relation", async () => {
    const input = await prepare({
      "src/a.ts": 'import { f } from "./barrel"; f();',
      "src/barrel.ts": 'export { f } from "./forward";',
      "src/forward.ts": 'export { f } from "./terminal";',
      "src/terminal.ts": 'export function f() {}',
    });
    expect(input.graph.moduleGraph.edges).toHaveLength(1);
    expect(input.graph.moduleGraph.edges[0]?.targetFilePath).toBe("src/barrel.ts");
    const terminal = input.symbolTables[3]?.symbols.find((symbol) => symbol.kind === "export");
    const imported = input.symbolTables[0]?.symbols.find((symbol) => symbol.kind === "import");
    expect(input.graph.edges[0]).toMatchObject({ targetFilePath: "src/terminal.ts", targetExportSymbolId: terminal?.id });
    expect(input.graph.edges[0]?.id).toBe(createHash("sha256").update(`${imported?.id}:${terminal?.id}`).digest("hex"));
    const semantic = new DeterministicSemanticAnalysisEngine().analyze({ ...input, dependencyGraph: input.graph });
    expect(semantic.calls[0]).toMatchObject({ resolutionState: "RESOLVED", targetSymbolId: terminal?.id });
  });

  test("T6 one reference per declaration associates all specifiers and preserves duplicates", async () => {
    const { symbolTables, graph } = await prepare({
      "src/a.ts": 'import { b, c } from "./b"; import { b as again } from "./b"; import "./b";',
      "src/b.ts": 'import "./a"; export const b = 1; export const c = 2;',
    });
    expect(symbolTables[0]?.moduleReferences?.map((reference) => reference.importSymbolIds.length)).toEqual([2, 1, 1]);
    expect(graph.moduleGraph.edges).toHaveLength(4);
    expect(new Set(graph.moduleGraph.edges.map((edge) => edge.id)).size).toBe(4);
    expect(graph.edges).toHaveLength(3);
    expect(graph.cycles).toEqual([["src/a.ts", "src/b.ts", "src/a.ts"]]);
  });

  test("T7 side-effect relations create no knowledge import, callable target, or used export", async () => {
    const input = await prepare({ "src/a.ts": 'import "./b"; f();', "src/b.ts": "export function f() {}" });
    expect(input.graph.edges).toEqual([]);
    const knowledge = new DeterministicKnowledgeGraphBuilder().build(input.symbolTables, input.graph);
    expect(knowledge.edges.filter((edge) => edge.relationship === "imports")).toEqual([]);
    expect(knowledge.nodes.filter((node) => node.kind === "symbol")).toHaveLength(input.symbolTables.flatMap((table) => table.symbols).length);
    const semantic = new DeterministicSemanticAnalysisEngine().analyze({ ...input, dependencyGraph: input.graph });
    expect(semantic.calls).toHaveLength(1);
    expect(semantic.calls[0]?.resolutionState).toBe("UNRESOLVED");
    expect(semantic.calls[0]?.targetSymbolId).toBeUndefined();
    expect(semantic.unusedExports.map((finding) => finding.name)).toEqual(["f"]);
    const historical = { nodes: input.graph.nodes, edges: input.graph.edges, cycles: input.graph.cycles };
    expect(new DeterministicSemanticAnalysisEngine().analyze({ ...input, dependencyGraph: historical })).toEqual(semantic);
  });

  test("T9 type-only and mixed declarations retain structural relations and existing bindings", async () => {
    const { graph, symbolTables } = await prepare({
      "src/a.ts": 'import type { T } from "./b"; import { type T as U, value } from "./b";',
      "src/b.ts": 'export class T {} export const value = 1; import type { X } from "./a";',
    });
    expect(symbolTables[0]?.moduleReferences?.map((reference) => reference.sourcePhase)).toEqual(["type", "mixed"]);
    expect(graph.moduleGraph.edges.map((edge) => edge.sourcePhase).sort()).toEqual(["mixed", "type", "type"]);
    expect(graph.edges).toHaveLength(3);
    expect(graph.cycles).toEqual([["src/a.ts", "src/b.ts", "src/a.ts"]]);
  });

  test("T10 three fresh runs and input permutations preserve exact serializations", async () => {
    const sources = { "src/a.ts": 'import { b } from "./b"; import "./b";', "src/b.ts": 'import "./a"; export const b = 1;' };
    const serializations: string[] = [];
    for (let run = 0; run < 3; run += 1) serializations.push(JSON.stringify((await prepare(sources)).graph));
    expect(new Set(serializations).size).toBe(1);
    const reversed = await prepare(Object.fromEntries(Object.entries(sources).reverse()));
    expect(JSON.stringify(reversed.graph)).toBe(serializations[0]!);
    expect(JSON.stringify(new DeterministicDependencyGraphBuilder().build([...reversed.symbolTables].reverse(), [...reversed.files].reverse()))).toBe(serializations[0]!);
    console.log("F07_DETERMINISM_SHA256", createHash("sha256").update(serializations[0]!).digest("hex"));
  });

  test("T10 canonical paths and symbol IDs do not enter module edge identity", async () => {
    const input = await prepare({ "C:/project/src/a.ts": 'import "./b";', "C:/project/src/b.ts": "" });
    const other = await prepare({ "c:\\project\\src\\a.ts": 'import "./b";', "c:\\project\\src\\b.ts": "" });
    expect(other.graph.moduleGraph).toEqual(input.graph.moduleGraph);
    const edge = input.graph.moduleGraph.edges[0]!;
    const anchor = edge.sourceAnchor;
    const tuple = anchor.kind === "offset" ? ["offset", anchor.start, anchor.end]
      : ["location", anchor.start.line, anchor.start.column, anchor.end.line, anchor.end.column];
    expect(edge.id).toBe(createHash("sha256").update(JSON.stringify(["f07-module-edge-v1", "c:/project/src/a.ts", "esm-side-effect", tuple, "./b", "c:/project/src/b.ts"])).digest("hex"));
    const renamed = input.symbolTables.map((table) => ({ ...table,
      symbols: table.symbols.map((symbol) => ({ ...symbol, id: `renamed:${symbol.id}` })),
      moduleReferences: table.moduleReferences?.map((reference) => ({ ...reference, importSymbolIds: reference.importSymbolIds.map((id) => `renamed:${id}`) })),
    }));
    expect(new DeterministicDependencyGraphBuilder().build(renamed, input.files).moduleGraph).toEqual(input.graph.moduleGraph);
    expect(edge).not.toHaveProperty("targetExportSymbolId");
    expect(edge).not.toHaveProperty("importSymbolId");
  });

  test("T11 unresolved targets are absent and only recognized CommonJS occurrences survive", async () => {
    const input = await prepare({
      "src/a.ts": 'const { b, c: localC } = require("./b"); const f = require("./b").f; const all = require("./b"); require("./b"); import "./missing"; import "node:fs";',
      "src/b.ts": 'export const b = 1; export const c = 2; export function f() {} export default 1;',
    });
    expect(input.symbolTables[0]?.moduleReferences?.map((reference) => reference.form)).toEqual(["commonjs-import", "commonjs-import", "commonjs-import", "esm-side-effect", "esm-side-effect"]);
    expect(input.graph.moduleGraph.edges).toHaveLength(3);
    expect(input.graph.edges).toHaveLength(4);
    expect(input.graph.moduleGraph.edges.every((edge) => edge.form === "commonjs-import" && edge.targetFilePath === "src/b.ts")).toBe(true);
    expect(input.symbolTables[0]?.moduleReferences?.[0]?.importSymbolIds).toHaveLength(2);
    const bare = await prepare({ "src/a.ts": 'require("./b");', "src/b.ts": "" });
    expect(bare.graph.moduleGraph.edges).toEqual([]);
  });

  test("T12 re-export-only links remain outside import-relations-v1", async () => {
    const { graph, symbolTables } = await prepare({ "src/a.ts": 'export { b } from "./b"; export * from "./b";', "src/b.ts": 'export * from "./a"; export const b = 1;' });
    expect(symbolTables.map((table) => table.moduleReferences)).toEqual([[], []]);
    expect(graph.moduleGraph.edges).toEqual([]);
    expect(graph.cycles).toEqual([]);
  });

  test("T13 offsets survive unlocated ASTs; location fallback is immutable; no anchor rejects current graph", async () => {
    const input = await prepare({ "src/a.ts": 'import "./b";', "src/b.ts": "" });
    function transform(node: ASTNode, mode: "offset" | "location" | "none"): ASTNode {
      const { start, end, ...rest } = node.attributes;
      return { ...node, location: mode === "location" ? node.location : undefined,
        attributes: mode === "offset" ? node.attributes : rest, children: node.children.map((child) => transform(child, mode)) };
    }
    const tables = (mode: "offset" | "location" | "none") => input.astResults.map((ast) => new JavaScriptSymbolExtractor().extract({ ...ast, root: transform(ast.root, mode) }));
    const offsetGraph = new DeterministicDependencyGraphBuilder().build(tables("offset"), input.files);
    expect(offsetGraph.moduleGraph.edges[0]?.sourceAnchor.kind).toBe("offset");
    expect(offsetGraph.moduleGraph).toEqual(input.graph.moduleGraph);
    const locationTables = tables("location");
    const locationGraph = new DeterministicDependencyGraphBuilder().build(locationTables, input.files);
    const anchor = locationGraph.moduleGraph.edges[0]!.sourceAnchor;
    expect(anchor.kind).toBe("location");
    expect(Object.isFrozen(anchor)).toBe(true);
    if (anchor.kind === "location") expect(Object.isFrozen(anchor.start)).toBe(true);
    expect(Object.isFrozen(locationTables[0]?.moduleReferences?.[0]?.importSymbolIds)).toBe(true);
    expect(() => new DeterministicDependencyGraphBuilder().build(tables("none"), input.files)).toThrow("lacks source anchor");
    expect(() => new DeterministicDependencyGraphBuilder().build(input.symbolTables.map(({ moduleReferences, ...table }) => table), input.files)).toThrow("require module reference evidence");
    expect(() => new DeterministicDependencyGraphBuilder().build(input.symbolTables.map((table) => ({ ...table, moduleReferences: [] })), input.files)).toThrow("require complete module reference evidence");
  });

  test("self-loop, three-node cycle and disconnected cycles retain canonical algorithm behavior", async () => {
    const self = await prepare({ "src/a.ts": 'import "./a";' });
    expect(self.graph.cycles).toEqual([["src/a.ts", "src/a.ts"]]);
    const three = await prepare({ "src/a.ts": 'import "./b";', "src/b.ts": 'import "./c";', "src/c.ts": 'import "./a";' });
    expect(three.graph.cycles).toEqual([["src/a.ts", "src/b.ts", "src/c.ts", "src/a.ts"]]);
    const disconnected = await prepare({ "src/a.ts": 'import "./b";', "src/b.ts": 'import "./a";', "src/c.ts": 'import "./d";', "src/d.ts": 'import "./c";' });
    expect(disconnected.graph.cycles).toEqual([["src/a.ts", "src/b.ts", "src/a.ts"], ["src/c.ts", "src/d.ts", "src/c.ts"]]);
  });
});

test("T11 existing assignment and chained-assignment CommonJS imports retain occurrence anchors", async () => {
  const input = await prepare({
    "src/a.ts": 'module.exports = require("./b"); exports = module.exports = require("./b");',
    "src/b.ts": "export default function f() {}",
  });
  expect(input.symbolTables[0]?.moduleReferences?.map((reference) => reference.importSymbolIds.length)).toEqual([1, 2]);
  expect(input.graph.moduleGraph.edges).toHaveLength(2);
  expect(input.graph.edges).toHaveLength(3);
  expect(input.graph.moduleGraph.edges.every((edge) => edge.form === "commonjs-import" && edge.sourceAnchor.kind === "offset")).toBe(true);
});
