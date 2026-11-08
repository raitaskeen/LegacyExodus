import { describe, expect, test } from "bun:test";

import type { FileArtifact } from "@contracts/discovery";
import { DeterministicDependencyGraphBuilder } from "@graph/dependency-graph-builder";
import { JavaScriptParser, type ASTResult } from "@parser/index";
import { DeterministicSemanticAnalysisEngine } from "@semantic/semantic-engine";
import { JavaScriptSymbolExtractor, type SymbolTable } from "@symbols/index";

async function analyze(sources: Readonly<Record<string, string>>) {
  const parser = new JavaScriptParser();
  const extractor = new JavaScriptSymbolExtractor();
  const files: FileArtifact[] = [];
  const astResults: ASTResult[] = [];
  const symbolTables: SymbolTable[] = [];
  for (const [path, source] of Object.entries(sources)) {
    const file: FileArtifact = { id: `file:${path}`, path, language: "javascript", size: source.length };
    const ast = (await parser.parse({ file, source })).result;
    files.push(file);
    astResults.push(ast);
    symbolTables.push(extractor.extract(ast));
  }
  const graph = new DeterministicDependencyGraphBuilder().build(symbolTables, files);
  const semantic = new DeterministicSemanticAnalysisEngine().analyze({ astResults, symbolTables, dependencyGraph: graph });
  const symbols = symbolTables.flatMap((table) => table.symbols);
  const exportId = (filePath: string, name: string) => symbols.find((symbol) => symbol.kind === "export" && symbol.filePath === filePath && symbol.name === name)?.id;
  const unused = semantic.unusedExports.map((finding) => `${finding.filePath}:${finding.name}`).sort();
  return { graph, semantic, symbols, exportId, unused };
}

const lib = "export function a() {}\nexport function b() {}\n";

describe("BA-09 namespace imports", () => {
  test("a namespace import binds to no single export", async () => {
    const { graph, symbols } = await analyze({ "lib.js": lib, "main.js": "import * as lib from './lib.js';\nlib.b();\n" });
    const namespaceImport = symbols.find((symbol) => symbol.kind === "import" && symbol.name === "lib");
    expect(namespaceImport).toBeDefined();
    expect(graph.edges.filter((edge) => edge.importSymbolId === namespaceImport?.id)).toEqual([]);
    expect(graph.moduleGraph?.edges.map((edge) => `${edge.sourceFilePath}->${edge.targetFilePath}`)).toEqual(["main.js->lib.js"]);
  });

  test("a call through a namespace resolves to the member export", async () => {
    const { semantic, exportId } = await analyze({ "lib.js": lib, "main.js": "import * as lib from './lib.js';\nlib.b();\n" });
    expect(semantic.calls.map((call) => [call.calleeName, call.targetSymbolId])).toEqual([["lib.b", exportId("lib.js", "b")]]);
  });

  test("calling the namespace object itself does not resolve to an arbitrary export", async () => {
    const { semantic } = await analyze({ "lib.js": lib, "main.js": "import * as lib from './lib.js';\nlib();\n" });
    expect(semantic.calls.map((call) => [call.calleeName, call.resolutionState])).toEqual([["lib", "UNRESOLVED"]]);
  });

  test("exports of a namespace-imported module are not reported unused", async () => {
    // The namespace object can escape (`use(lib)`, `lib[key]`), so every export it exposes may be read.
    const { unused } = await analyze({ "lib.js": lib, "main.js": "import * as lib from './lib.js';\nuse(lib);\n" });
    expect(unused).toEqual([]);
  });

  test("exports reached through export-star of a namespace-imported module are not unused", async () => {
    const { unused } = await analyze({
      "core.js": "export function deep() {}\n",
      "lib.js": "export * from './core.js';\nexport const own = 1;\n",
      "main.js": "import * as lib from './lib.js';\nuse(lib);\n",
      "other.js": "export const lonely = 1;\n",
    });
    expect(unused).toEqual(["other.js:lonely"]);
  });

  test("an export-as-namespace re-export binds importers to the re-export and keeps the module's exports used", async () => {
    const { graph, unused, exportId, symbols } = await analyze({
      "lib.js": lib,
      "index.js": "export * as ns from './lib.js';\n",
      "main.js": "import { ns } from './index.js';\nns.a();\n",
    });
    const nsImport = symbols.find((symbol) => symbol.kind === "import" && symbol.name === "ns");
    expect(graph.edges.filter((edge) => edge.importSymbolId === nsImport?.id).map((edge) => edge.targetExportSymbolId)).toEqual([exportId("index.js", "ns") ?? "missing"]);
    expect(unused).toEqual([]);
  });

  test("exports of modules that are only named-imported keep precise findings", async () => {
    const { unused } = await analyze({ "lib.js": lib, "main.js": "import { a } from './lib.js';\na();\n" });
    expect(unused).toEqual(["lib.js:b"]);
  });
});
