import { describe, expect, test } from "bun:test";

import type { FileArtifact } from "@contracts/discovery";
import { DeterministicDependencyGraphBuilder } from "@graph/dependency-graph-builder";
import { JavaScriptParser, type ASTResult } from "@parser/index";
import { DeterministicSemanticAnalysisEngine } from "@semantic/semantic-engine";
import { JavaScriptSymbolExtractor, type SymbolTable } from "@symbols/index";

interface Fixture {
  readonly id: string;
  readonly title: string;
  readonly sources: Readonly<Record<string, string>>;
  readonly terminal?: string;
  readonly callee?: string;
  readonly noCall?: boolean;
}

const importF = 'import { f } from "./b.js"; f();';
const forwardF = 'export { f } from "./c.js";';
const missingF = 'export { f } from "./missing.js";';
const definitionF = "export function f() {}";
const fixtures: readonly Fixture[] = [
  { id: "T01", title: "valid direct import", sources: { "a.js": importF, "b.js": definitionF }, terminal: "b.js" },
  { id: "T02", title: "valid one-hop named re-export", sources: { "a.js": importF, "b.js": forwardF, "c.js": definitionF }, terminal: "c.js" },
  { id: "T03", title: "valid multi-hop named re-export", sources: { "a.js": importF, "b.js": forwardF, "c.js": 'export { f } from "./d.js";', "d.js": definitionF }, terminal: "d.js" },
  { id: "T04", title: "missing forwarding module retains provenance without a terminal", sources: { "a.js": importF, "b.js": missingF } },
  { id: "T05", title: "direct missing import control", sources: { "a.js": 'import { f } from "./missing.js"; f();' } },
  { id: "T06", title: "existing module with missing export", sources: { "a.js": importF, "b.js": forwardF, "c.js": "export function g() {}" } },
  { id: "T07", title: "missing aliased re-export retains alias metadata", sources: { "a.js": 'import { publicF } from "./b.js"; publicF();', "b.js": 'export { f as publicF } from "./missing.js";' }, callee: "publicF" },
  { id: "T08", title: "local import alias through missing forwarding", sources: { "a.js": 'import { f as localF } from "./b.js"; localF();', "b.js": missingF }, callee: "localF" },
  { id: "T09", title: "valid alias targets actual terminal f", sources: { "a.js": 'import { publicF } from "./b.js"; publicF();', "b.js": 'export { f as publicF } from "./c.js";', "c.js": definitionF }, terminal: "c.js", callee: "publicF" },
  { id: "T10", title: "callless missing forwarding has no dependency edge", sources: { "a.js": 'import { f } from "./b.js";', "b.js": missingF }, noCall: true },
  { id: "T11", title: "non-call reference preserves its lexical import binding", sources: { "a.js": 'import { f } from "./b.js"; const x = f;', "b.js": missingF }, noCall: true },
  { id: "T12", title: "forwarding cycle terminates without a terminal", sources: { "a.js": importF, "b.js": forwardF, "c.js": 'export { f } from "./b.js";' } },
  { id: "T13", title: "self re-export terminates without a terminal", sources: { "a.js": importF, "b.js": 'export { f } from "./b.js";' } },
  { id: "T14", title: "valid export-star control", sources: { "a.js": importF, "b.js": 'export * from "./c.js";', "c.js": definitionF }, terminal: "c.js" },
  { id: "T15", title: "missing export-star control", sources: { "a.js": importF, "b.js": 'export * from "./missing.js";' } },
  { id: "T16", title: "ambiguous export-star control", sources: { "a.js": importF, "b.js": 'export * from "./c.js"; export * from "./d.js";', "c.js": definitionF, "d.js": definitionF } },
  { id: "T17", title: "external forwarding remains unresolved", sources: { "a.js": importF, "b.js": 'export { f } from "lodash";' } },
  { id: "T18", title: "node builtin forwarding remains unresolved", sources: { "a.js": 'import { readFile } from "./b.js"; readFile();', "b.js": 'export { readFile } from "node:fs";' }, callee: "readFile" },
];

async function prepare(fixture: Fixture, order = Object.keys(fixture.sources)) {
  const parser = new JavaScriptParser();
  const extractor = new JavaScriptSymbolExtractor();
  const files: FileArtifact[] = [];
  const astResults: ASTResult[] = [];
  const symbolTables: SymbolTable[] = [];
  for (const path of order) {
    const source = fixture.sources[path];
    if (source === undefined) throw new Error(`Missing fixture source: ${path}`);
    const file: FileArtifact = { id: `file:${path}`, path, language: "javascript", size: source.length };
    const ast = (await parser.parse({ file, source })).result;
    files.push(file);
    astResults.push(ast);
    symbolTables.push(extractor.extract(ast));
  }
  return { files, astResults, symbolTables };
}

function analyze(
  input: Awaited<ReturnType<typeof prepare>>,
  builder = new DeterministicDependencyGraphBuilder(),
  engine = new DeterministicSemanticAnalysisEngine(),
) {
  const graph = builder.build(input.symbolTables, input.files);
  const semantic = engine.analyze({ ...input, dependencyGraph: graph });
  return { ...input, graph, semantic };
}

function serialize(result: ReturnType<typeof analyze>): string {
  return JSON.stringify({ edges: result.graph.edges, calls: result.semantic.calls });
}

function fixtureById(id: string): Fixture {
  const fixture = fixtures.find((entry) => entry.id === id);
  if (fixture === undefined) throw new Error(`Missing fixture ${id}`);
  return fixture;
}

function checkProvenance(result: ReturnType<typeof analyze>, fixture: Fixture): void {
  for (const table of result.symbolTables) {
    const source = fixture.sources[table.filePath];
    if (source === undefined) throw new Error("Missing source for symbol table");
    if (!source.startsWith("export {")) continue;
    const name = fixture.id === "T07" || fixture.id === "T09" ? "publicF"
      : fixture.id === "T18" ? "readFile" : "f";
    const sourceName = fixture.id === "T18" ? "readFile" : "f";
    const moduleSpecifier = source.match(/from "([^"]+)"/)?.[1];
    expect(moduleSpecifier).toBeDefined();
    expect(table.symbols).toHaveLength(1);
    expect(table.symbols[0]).toMatchObject({
      kind: "export", name, filePath: table.filePath, moduleSpecifier, sourceSymbolName: sourceName,
    });
    expect(result.graph.nodes.some((node) => node.symbolId === table.symbols[0]?.id)).toBe(true);
  }
}

function checkResolution(result: ReturnType<typeof analyze>, fixture: Fixture): void {
  checkProvenance(result, fixture);
  if (fixture.id === "T11") {
    const imported = result.symbolTables.find((table) => table.filePath === "a.js")?.symbols
      .find((symbol) => symbol.kind === "import" && symbol.name === "f");
    expect(imported).toBeDefined();
    const references = result.semantic.references.filter((reference) =>
      reference.filePath === "a.js" && reference.kind === "identifier" && reference.name === "f");
    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({ resolutionState: "RESOLVED", resolvedSymbolId: imported?.id });
    expect(result.semantic.unusedImports).toEqual([]);
  }

  if (fixture.terminal !== undefined) {
    const table = result.symbolTables.find((entry) => entry.filePath === fixture.terminal);
    const terminal = table?.symbols.find((symbol) => symbol.kind === "export" && symbol.name === "f");
    expect(terminal).toBeDefined();
    expect(terminal?.moduleSpecifier).toBeUndefined();
    expect(table?.symbols.some((symbol) => symbol.kind === "function" && symbol.name === "f" && symbol.exported)).toBe(true);
    expect(result.graph.edges).toHaveLength(1);
    expect(result.graph.edges[0]).toMatchObject({
      sourceFilePath: "a.js", targetFilePath: fixture.terminal, targetExportSymbolId: terminal?.id,
    });
    expect(result.semantic.calls).toHaveLength(1);
    expect(result.semantic.calls[0]).toMatchObject({
      sourceFilePath: "a.js", calleeName: fixture.callee ?? "f",
      resolutionState: "RESOLVED", targetSymbolId: terminal?.id,
    });
    const forwardingIds = result.symbolTables.flatMap((entry) => entry.symbols)
      .filter((symbol) => symbol.kind === "export" && symbol.moduleSpecifier !== undefined)
      .map((symbol) => symbol.id);
    expect(forwardingIds).not.toContain(result.graph.edges[0]?.targetExportSymbolId);
    expect(forwardingIds).not.toContain(result.semantic.calls[0]?.targetSymbolId);
  } else {
    expect(result.graph.edges).toEqual([]);
    if (fixture.noCall) {
      expect(result.semantic.calls).toEqual([]);
    } else {
      expect(result.semantic.calls).toHaveLength(1);
      expect(result.semantic.calls[0]).toMatchObject({
        sourceFilePath: "a.js", calleeName: fixture.callee ?? "f", resolutionState: "UNRESOLVED",
      });
      expect(result.semantic.calls[0]?.targetSymbolId).toBeUndefined();
    }
  }
}

describe("F04 named re-export terminal resolution", () => {
  for (const fixture of fixtures) {
    test(`${fixture.id} ${fixture.title}`, async () => {
      const input = await prepare(fixture);
      const result = analyze(input);
      checkResolution(result, fixture);
      if (fixture.id === "T03" || fixture.id === "T12" || fixture.id === "T13") {
        expect(serialize(analyze(input))).toBe(serialize(result));
      }
    });
  }

  test("T19 file-order permutations preserve exact graph edges and calls", async () => {
    for (const id of ["T01", "T04", "T07", "T12", "T17"]) {
      const fixture = fixtureById(id);
      const order = Object.keys(fixture.sources);
      const expected = serialize(analyze(await prepare(fixture, order)));
      expect(serialize(analyze(await prepare(fixture, [...order].reverse())))).toBe(expected);
    }
    const fixture = fixtureById("T03");
    const expected = serialize(analyze(await prepare(fixture, ["a.js", "b.js", "c.js", "d.js"])));
    for (const order of [["d.js", "c.js", "b.js", "a.js"], ["b.js", "d.js", "a.js", "c.js"]]) {
      expect(serialize(analyze(await prepare(fixture, order)))).toBe(expected);
    }
  });

  test("T20 three fresh and three reused builder executions preserve output across a mixed corpus", async () => {
    const ids = ["T01", "T02", "T03", "T04", "T07", "T06", "T12", "T17"];
    const inputs = await Promise.all(ids.map((id) => prepare(fixtureById(id))));
    const freshRuns = [0, 1, 2].map(() => inputs.map((input) => serialize(analyze(input))));
    const expected = freshRuns[0];
    if (expected === undefined) throw new Error("Missing fresh-run reference output");
    expect(freshRuns[1]).toEqual(expected);
    expect(freshRuns[2]).toEqual(expected);
    const builder = new DeterministicDependencyGraphBuilder();
    const engine = new DeterministicSemanticAnalysisEngine();
    for (let run = 0; run < 3; run += 1) {
      expect(inputs.map((input) => serialize(analyze(input, builder, engine)))).toEqual(expected);
    }
  });
});

