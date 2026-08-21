import { describe, expect, test } from "bun:test";

import { validateDependencyGraph } from "@graph/index";

describe("DependencyGraph contracts", () => {
  test("validates and freezes directed dependency edges", (): void => {
    const graph = validateDependencyGraph({
      nodes: [{ id: "node-a", filePath: "src/api.js", symbolId: "symbol-a" }],
      edges: [{
        id: "edge-a",
        sourceFilePath: "src/api.js",
        targetFilePath: "src/billing.js",
        importSymbolId: "import-a",
        targetExportSymbolId: "export-b",
        moduleSpecifier: "./billing.js",
      }],
      cycles: [],
    });

    expect(Object.isFrozen(graph)).toBe(true);
    expect(Object.isFrozen(graph.edges)).toBe(true);
    expect(graph.edges[0]?.targetFilePath).toBe("src/billing.js");
  });

  test("resolves multiple wildcard re-exports deterministically and isolates ambiguous exports", async (): Promise<void> => {
    const { JavaScriptParser } = await import("@parser/index");
    const { JavaScriptSymbolExtractor } = await import("@symbols/index");
    const { DeterministicDependencyGraphBuilder } = await import("@graph/index");

    const parser = new JavaScriptParser();
    const extractor = new JavaScriptSymbolExtractor();

    const files = [
      { id: "barrel", path: "src/barrel.js", language: "javascript", size: 1 },
      { id: "modA", path: "src/a.js", language: "javascript", size: 1 },
      { id: "modB", path: "src/b.js", language: "javascript", size: 1 },
      { id: "consumer", path: "src/consumer.js", language: "javascript", size: 1 },
    ] as const;

    const astBarrel = (await parser.parse({ file: files[0], source: "export * from './a'; export * from './b';" })).result;
    const astA = (await parser.parse({ file: files[1], source: "export function funcA() {} export function conflict() {}" })).result;
    const astB = (await parser.parse({ file: files[2], source: "export function funcB() {} export function conflict() {}" })).result;
    const astConsumer = (await parser.parse({ file: files[3], source: "import { funcA, funcB, conflict, nonExistent } from './barrel';" })).result;

    const tables = [extractor.extract(astBarrel), extractor.extract(astA), extractor.extract(astB), extractor.extract(astConsumer)] as const;
    const [, tableA, tableB, tableConsumer] = tables;
    const graph = new DeterministicDependencyGraphBuilder().build(tables, files);

    const importFuncA = tableConsumer.symbols.find((s) => s.kind === "import" && s.name === "funcA");
    const importFuncB = tableConsumer.symbols.find((s) => s.kind === "import" && s.name === "funcB");
    const importConflict = tableConsumer.symbols.find((s) => s.kind === "import" && s.name === "conflict");
    const importNonExistent = tableConsumer.symbols.find((s) => s.kind === "import" && s.name === "nonExistent");

    const exportFuncA = tableA.symbols.find((s) => s.kind === "export" && s.name === "funcA");
    const exportFuncB = tableB.symbols.find((s) => s.kind === "export" && s.name === "funcB");

    const edgeFuncA = graph.edges.find((e) => e.importSymbolId === importFuncA?.id);
    const edgeFuncB = graph.edges.find((e) => e.importSymbolId === importFuncB?.id);
    const edgeConflict = graph.edges.find((e) => e.importSymbolId === importConflict?.id);
    const edgeNonExistent = graph.edges.find((e) => e.importSymbolId === importNonExistent?.id);

    expect(edgeFuncA?.targetExportSymbolId).toBe(exportFuncA?.id);
    expect(edgeFuncA?.targetFilePath).toBe("src/a.js");

    expect(edgeFuncB?.targetExportSymbolId).toBe(exportFuncB?.id);
    expect(edgeFuncB?.targetFilePath).toBe("src/b.js");

    // Ambiguous export in both wildcard targets must NOT create an edge
    expect(edgeConflict).toBeUndefined();

    // Non-existent export must NOT create an edge
    expect(edgeNonExistent).toBeUndefined();
  });

  test("handles circular barrels without infinite recursion", async (): Promise<void> => {
    const { JavaScriptParser } = await import("@parser/index");
    const { JavaScriptSymbolExtractor } = await import("@symbols/index");
    const { DeterministicDependencyGraphBuilder } = await import("@graph/index");

    const parser = new JavaScriptParser();
    const extractor = new JavaScriptSymbolExtractor();

    const files = [
      { id: "circA", path: "src/circ-a.js", language: "javascript", size: 1 },
      { id: "circB", path: "src/circ-b.js", language: "javascript", size: 1 },
      { id: "consumer", path: "src/consumer.js", language: "javascript", size: 1 },
    ] as const;

    const astCircA = (await parser.parse({ file: files[0], source: "export * from './circ-b'; export function itemA() {}" })).result;
    const astCircB = (await parser.parse({ file: files[1], source: "export * from './circ-a'; export function itemB() {}" })).result;
    const astConsumer = (await parser.parse({ file: files[2], source: "import { itemA, itemB, missing } from './circ-a';" })).result;

    const tables = [extractor.extract(astCircA), extractor.extract(astCircB), extractor.extract(astConsumer)] as const;
    const [tableCircA, tableCircB, tableCircConsumer] = tables;
    const graph = new DeterministicDependencyGraphBuilder().build(tables, files);

    const importA = tableCircConsumer.symbols.find((s) => s.kind === "import" && s.name === "itemA");
    const importB = tableCircConsumer.symbols.find((s) => s.kind === "import" && s.name === "itemB");
    const importMissing = tableCircConsumer.symbols.find((s) => s.kind === "import" && s.name === "missing");

    const exportA = tableCircA.symbols.find((s) => s.kind === "export" && s.name === "itemA");
    const exportB = tableCircB.symbols.find((s) => s.kind === "export" && s.name === "itemB");

    expect(graph.edges.find((e) => e.importSymbolId === importA?.id)?.targetExportSymbolId).toBe(exportA?.id);
    expect(graph.edges.find((e) => e.importSymbolId === importB?.id)?.targetExportSymbolId).toBe(exportB?.id);
    expect(graph.edges.find((e) => e.importSymbolId === importMissing?.id)).toBeUndefined();
  });
});
