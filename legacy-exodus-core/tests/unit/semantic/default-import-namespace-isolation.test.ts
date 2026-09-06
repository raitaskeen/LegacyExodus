import { describe, expect, it } from "bun:test";
import { JavaScriptParser } from "@parser/adapters/javascript/javascript-parser";
import { JavaScriptSymbolExtractor } from "@symbols/javascript-symbol-extractor";
import { DeterministicDependencyGraphBuilder } from "@graph/dependency-graph-builder";
import { DeterministicSemanticAnalysisEngine } from "@semantic/semantic-engine";
import { DeterministicCallGraphBuilder } from "@semantic/call-graph-builder";

describe("Semantic Default Import vs Namespace Call Isolation", () => {
  it("does not resolve named exports when receiver is an ESM default import", async () => {
    const parser = new JavaScriptParser();
    const extractor = new JavaScriptSymbolExtractor();
    const depBuilder = new DeterministicDependencyGraphBuilder();
    const callGraphBuilder = new DeterministicCallGraphBuilder();
    const engine = new DeterministicSemanticAnalysisEngine(callGraphBuilder);

    const apiSource = `
      export function ping() { return "pong"; }
      export default function defaultFn() { return "default"; }
    `;
    const clientSource = `
      import api from "./api";
      function test() {
        api.ping();
      }
    `;

    const apiFile = { id: "f1", path: "src/api.js", language: "javascript", size: apiSource.length };
    const clientFile = { id: "f2", path: "src/client.js", language: "javascript", size: clientSource.length };

    const apiAst = (await parser.parse({ file: apiFile, source: apiSource })).result!;
    const clientAst = (await parser.parse({ file: clientFile, source: clientSource })).result!;

    const apiSymbols = extractor.extract(apiAst);
    const clientSymbols = extractor.extract(clientAst);

    const depGraph = depBuilder.build([apiSymbols, clientSymbols], [apiFile, clientFile]);
    const analysis = engine.analyze({
      astResults: [apiAst, clientAst],
      dependencyGraph: depGraph,
      symbolTables: [apiSymbols, clientSymbols],
    });

    const defaultExportSymbol = apiSymbols.symbols.find((s) => s.kind === "export" && s.defaultExport);
    expect(defaultExportSymbol).toBeDefined();

    const importEdge = depGraph.edges.find((e) => e.sourceFilePath === clientFile.path);
    expect(importEdge).toBeDefined();
    expect(importEdge?.targetExportSymbolId).toBe(defaultExportSymbol?.id);

    const pingExportSymbol = apiSymbols.symbols.find((s) => s.kind === "export" && s.name === "ping");
    expect(pingExportSymbol).toBeDefined();

    const call = analysis.calls.find((c) => c.calleeName === "api.ping");
    expect(call).toBeDefined();

    // ESM default import must NOT resolve to the named export "ping"!
    expect(call?.targetSymbolId).not.toBe(pingExportSymbol?.id);
    expect(call?.resolutionState).not.toBe("RESOLVED");
  });

  it("correctly resolves named exports when receiver is a genuine namespace import", async () => {
    const parser = new JavaScriptParser();
    const extractor = new JavaScriptSymbolExtractor();
    const depBuilder = new DeterministicDependencyGraphBuilder();
    const callGraphBuilder = new DeterministicCallGraphBuilder();
    const engine = new DeterministicSemanticAnalysisEngine(callGraphBuilder);

    const apiSource = `
      export function ping() { return "pong"; }
    `;
    const clientSource = `
      import * as api from "./api";
      function test() {
        api.ping();
      }
    `;

    const apiFile = { id: "f1", path: "src/api.js", language: "javascript", size: apiSource.length };
    const clientFile = { id: "f2", path: "src/client.js", language: "javascript", size: clientSource.length };

    const apiAst = (await parser.parse({ file: apiFile, source: apiSource })).result!;
    const clientAst = (await parser.parse({ file: clientFile, source: clientSource })).result!;

    const apiSymbols = extractor.extract(apiAst);
    const clientSymbols = extractor.extract(clientAst);

    const depGraph = depBuilder.build([apiSymbols, clientSymbols], [apiFile, clientFile]);
    const analysis = engine.analyze({
      astResults: [apiAst, clientAst],
      dependencyGraph: depGraph,
      symbolTables: [apiSymbols, clientSymbols],
    });

    const pingExportSymbol = apiSymbols.symbols.find((s) => s.kind === "export" && s.name === "ping");
    expect(pingExportSymbol).toBeDefined();

    const call = analysis.calls.find((c) => c.calleeName === "api.ping");
    expect(call).toBeDefined();
    expect(call?.resolutionState).toBe("RESOLVED");
    expect(call?.targetSymbolId).toBe(pingExportSymbol?.id);
  });
});
