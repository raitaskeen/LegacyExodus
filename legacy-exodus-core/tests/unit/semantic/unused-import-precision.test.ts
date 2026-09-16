import { describe, expect, test } from "bun:test";

import type { FileArtifact } from "@contracts/discovery";
import { DeterministicDependencyGraphBuilder } from "@graph/index";
import { JavaScriptParser, type ASTResult } from "@parser/index";
import { DeterministicSemanticAnalysisEngine, type SemanticAnalysis } from "@semantic/index";
import { JavaScriptSymbolExtractor, type CodeSymbol, type SymbolTable } from "@symbols/index";

interface SourceFixture {
  readonly path: string;
  readonly source: string;
  readonly language?: "javascript" | "typescript";
}

interface AnalysisFixture {
  readonly analysis: SemanticAnalysis;
  readonly symbolTables: readonly SymbolTable[];
}

async function analyze(fixtures: readonly SourceFixture[]): Promise<AnalysisFixture> {
  const parser = new JavaScriptParser();
  const extractor = new JavaScriptSymbolExtractor();
  const files: readonly FileArtifact[] = fixtures.map((fixture, index) => ({
    id: `file-${index}`,
    path: fixture.path,
    language: fixture.language ?? "javascript",
    size: fixture.source.length,
  }));
  const astResults: ASTResult[] = [];
  const symbolTables: SymbolTable[] = [];

  for (let index = 0; index < fixtures.length; index += 1) {
    const fixture = fixtures[index];
    const file = files[index];
    if (fixture === undefined || file === undefined) throw new Error("Invalid semantic fixture.");
    const ast = (await parser.parse({ file, source: fixture.source })).result;
    astResults.push(ast);
    symbolTables.push(extractor.extract(ast));
  }

  const dependencyGraph = new DeterministicDependencyGraphBuilder().build(symbolTables, files);
  const analysis = new DeterministicSemanticAnalysisEngine().analyze({ astResults, dependencyGraph, symbolTables });
  return { analysis, symbolTables };
}

function importsFor(table: SymbolTable): readonly CodeSymbol[] {
  return table.symbols.filter((symbol) => symbol.kind === "import");
}

function exactImport(table: SymbolTable, name: string): CodeSymbol {
  const matches = importsFor(table).filter((symbol) => symbol.name === name);
  expect(matches).toHaveLength(1);
  const match = matches[0];
  if (match === undefined) throw new Error(`Missing import binding ${name}.`);
  return match;
}

function unusedNames(analysis: SemanticAnalysis, filePath: string): readonly string[] {
  return analysis.unusedImports
    .filter((finding) => finding.filePath === filePath)
    .map((finding) => finding.name)
    .sort();
}

function identifierTargets(analysis: SemanticAnalysis, filePath: string, name: string): readonly string[] {
  return analysis.references
    .filter((reference) => reference.filePath === filePath && reference.kind === "identifier" && reference.name === name)
    .flatMap((reference) => reference.resolvedSymbolId === undefined ? [] : [reference.resolvedSymbolId])
    .sort();
}

describe("IA-CRIT-002 unused import binding precision", () => {
  test("distinguishes used and unused external default imports without dependency edges", async () => {
    const used = await analyze([{ path: "src/used.js", source: 'import express from "express"; const app = express();' }]);
    const unused = await analyze([{ path: "src/unused.js", source: 'import express from "express"; const value = 1;' }]);
    const usedImport = exactImport(used.symbolTables[0]!, "express");

    expect(unusedNames(used.analysis, "src/used.js")).toEqual([]);
    expect(identifierTargets(used.analysis, "src/used.js", "express")).toEqual([usedImport.id]);
    expect(unusedNames(unused.analysis, "src/unused.js")).toEqual(["express"]);
    expect(identifierTargets(unused.analysis, "src/unused.js", "express")).toEqual([]);
  });

  test("distinguishes used and unused external named imports", async () => {
    const used = await analyze([{ path: "src/used.js", source: 'import { readFile } from "node:fs"; readFile("a.txt", () => {});' }]);
    const unused = await analyze([{ path: "src/unused.js", source: 'import { readFile } from "node:fs"; const value = 1;' }]);
    const usedImport = exactImport(used.symbolTables[0]!, "readFile");

    expect(unusedNames(used.analysis, "src/used.js")).toEqual([]);
    expect(identifierTargets(used.analysis, "src/used.js", "readFile")).toEqual([usedImport.id]);
    expect(unusedNames(unused.analysis, "src/unused.js")).toEqual(["readFile"]);
  });

  test("uses exact internal import bindings rather than resolved dependency existence", async () => {
    const fixture = await analyze([
      { path: "src/helper.js", source: "export function used() {} export function unused() {}" },
      { path: "src/main.js", source: 'import { used, unused } from "./helper"; used();' },
    ]);
    const main = fixture.symbolTables.find((table) => table.filePath === "src/main.js")!;
    const usedImport = exactImport(main, "used");
    const unusedImport = exactImport(main, "unused");

    expect(unusedNames(fixture.analysis, "src/main.js")).toEqual(["unused"]);
    expect(identifierTargets(fixture.analysis, "src/main.js", "used")).toEqual([usedImport.id]);
    expect(identifierTargets(fixture.analysis, "src/main.js", "unused")).toEqual([]);
    expect(usedImport.id).not.toBe(unusedImport.id);
  });

  test("tracks aliased imports by local binding identity", async () => {
    const fixture = await analyze([
      { path: "src/helper.js", source: "export function helper() {} export function other() {}" },
      { path: "src/main.js", source: 'import { helper as run, other as idle } from "./helper"; run();' },
    ]);
    const main = fixture.symbolTables.find((table) => table.filePath === "src/main.js")!;
    const runImport = exactImport(main, "run");

    expect(runImport.sourceSymbolName).toBe("helper");
    expect(unusedNames(fixture.analysis, "src/main.js")).toEqual(["idle"]);
    expect(identifierTargets(fixture.analysis, "src/main.js", "run")).toEqual([runImport.id]);
    expect(identifierTargets(fixture.analysis, "src/main.js", "helper")).toEqual([]);
  });

  test("tracks namespace imports through the namespace lexical binding", async () => {
    const fixture = await analyze([
      { path: "src/utils.js", source: "export function helper() {}" },
      { path: "src/main.js", source: 'import * as utils from "./utils"; import * as idleUtils from "./utils"; utils.helper();' },
    ]);
    const main = fixture.symbolTables.find((table) => table.filePath === "src/main.js")!;
    const utilsImport = exactImport(main, "utils");

    expect(unusedNames(fixture.analysis, "src/main.js")).toEqual(["idleUtils"]);
    expect(identifierTargets(fixture.analysis, "src/main.js", "utils")).toEqual([utilsImport.id]);
    expect(identifierTargets(fixture.analysis, "src/main.js", "helper")).toEqual([]);
  });

  test("does not let parameter or block shadowing mark an import binding as used", async () => {
    const fixture = await analyze([
      { path: "src/helper.js", source: "export function helper() {}" },
      {
        path: "src/main.js",
        source: `
          import { helper } from "./helper";
          function execute(helper) { helper(); }
          { const helper = () => {}; helper(); }
        `,
      },
    ]);
    const main = fixture.symbolTables.find((table) => table.filePath === "src/main.js")!;
    const imported = exactImport(main, "helper");

    expect(unusedNames(fixture.analysis, "src/main.js")).toEqual(["helper"]);
    expect(identifierTargets(fixture.analysis, "src/main.js", "helper")).not.toContain(imported.id);
  });

  test("resolves an import reference reached from a nested lexical scope", async () => {
    const fixture = await analyze([
      { path: "src/helper.js", source: "export function helper() {}" },
      { path: "src/main.js", source: 'import { helper } from "./helper"; function execute() { helper(); }' },
    ]);
    const main = fixture.symbolTables.find((table) => table.filePath === "src/main.js")!;
    const imported = exactImport(main, "helper");

    expect(unusedNames(fixture.analysis, "src/main.js")).toEqual([]);
    expect(identifierTargets(fixture.analysis, "src/main.js", "helper")).toEqual([imported.id]);
  });

  test("keeps same exported names from different modules isolated by local binding identity", async () => {
    const fixture = await analyze([
      { path: "src/a.js", source: "export function helper() {}" },
      { path: "src/b.js", source: "export function helper() {}" },
      { path: "src/main.js", source: 'import { helper as first } from "./a"; import { helper as second } from "./b"; first();' },
    ]);
    const main = fixture.symbolTables.find((table) => table.filePath === "src/main.js")!;
    const first = exactImport(main, "first");
    const second = exactImport(main, "second");

    expect(unusedNames(fixture.analysis, "src/main.js")).toEqual(["second"]);
    expect(identifierTargets(fixture.analysis, "src/main.js", "first")).toEqual([first.id]);
    expect(identifierTargets(fixture.analysis, "src/main.js", "second")).toEqual([]);
    expect(first.id).not.toBe(second.id);
  });

  test("does not classify a side-effect-only import as an unused lexical binding", async () => {
    const fixture = await analyze([
      { path: "src/polyfill.js", source: "globalThis.ready = true;" },
      { path: "src/main.js", source: 'import "./polyfill"; const value = 1;' },
    ]);

    expect(unusedNames(fixture.analysis, "src/main.js")).toEqual([]);
    expect(fixture.analysis.references.filter((reference) => reference.filePath === "src/main.js")).toEqual([]);
  });

  test("produces identical binding references and findings across repeated analysis", async () => {
    const fixtures = [
      { path: "src/helper.js", source: "export function helper() {} export function idle() {}" },
      { path: "src/main.js", source: 'import { helper, idle } from "./helper"; helper();' },
    ] as const;
    const first = await analyze(fixtures);
    const second = await analyze(fixtures);

    expect(second.analysis.references).toEqual(first.analysis.references);
    expect(second.analysis.unusedImports).toEqual(first.analysis.unusedImports);
  });
});
