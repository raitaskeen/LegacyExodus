import { describe, expect, it } from "bun:test";

import { DeterministicDependencyGraphBuilder } from "@graph/index";
import { JavaScriptParser } from "@parser/index";
import { DeterministicSemanticAnalysisEngine } from "@semantic/index";
import { JavaScriptSymbolExtractor } from "@symbols/index";

describe("Semantic Call-Graph: Var Receiver Scoping Semantics", () => {
  const parser = new JavaScriptParser();
  const extractor = new JavaScriptSymbolExtractor();
  const depBuilder = new DeterministicDependencyGraphBuilder();
  const engine = new DeterministicSemanticAnalysisEngine();

  async function analyze(source: string, filePath: string = "src/example.js") {
    const file = { id: "example", path: filePath, language: "javascript", size: source.length };
    const ast = (await parser.parse({ file, source })).result!;
    const symbolTable = extractor.extract(ast);
    const depGraph = depBuilder.build([symbolTable], [file]);
    const analysis = engine.analyze({
      astResults: [ast],
      dependencyGraph: depGraph,
      symbolTables: [symbolTable],
    });
    return { ast, symbolTable, depGraph, analysis };
  }

  it("resolves receiver method call when var is instantiated inside a nested block", async () => {
    const source = `
      class Service {
        start() { return 1; }
      }

      function example() {
        {
          var service = new Service();
        }
        service.start();
      }
    `;

    const { analysis, symbolTable } = await analyze(source);
    const startMethod = symbolTable.symbols.find((s) => s.kind === "method" && s.name === "start");
    expect(startMethod).toBeDefined();

    const startCall = analysis.calls.find((c) => c.calleeName === "service.start");
    expect(startCall).toBeDefined();
    expect(startCall?.resolutionState).toBe("RESOLVED");
    expect(startCall?.targetSymbolId).toBe(startMethod?.id);
  });

  it("preserves block-scoping boundaries for let / const declarations", async () => {
    const source = `
      class Service {
        start() { return 1; }
      }

      function example() {
        {
          const service = new Service();
        }
        service.start();
      }
    `;

    const { analysis } = await analyze(source);
    const startCall = analysis.calls.find((c) => c.calleeName === "service.start");
    expect(startCall).toBeDefined();
    // const must NOT leak out of the block scope
    expect(startCall?.resolutionState).toBe("UNRESOLVED");
    expect(startCall?.targetSymbolId).toBeUndefined();
  });

  it("preserves shadowing where inner let shadows outer var without leaking receiver types", async () => {
    const source = `
      class ServiceA {
        run() { return "a"; }
      }
      class ServiceB {
        run() { return "b"; }
      }

      function example() {
        var s = new ServiceA();
        {
          const s = new ServiceB();
          s.run();
        }
        s.run();
      }
    `;

    const { analysis, symbolTable } = await analyze(source);
    const serviceARun = symbolTable.symbols.find((s) => s.name === "run" && s.containerName === "ServiceA");
    const serviceBRun = symbolTable.symbols.find((s) => s.name === "run" && s.containerName === "ServiceB");
    expect(serviceARun).toBeDefined();
    expect(serviceBRun).toBeDefined();

    const runs = analysis.calls.filter((c) => c.calleeName === "s.run");
    expect(runs).toHaveLength(2);

    // First call inside block resolves to ServiceB.run
    expect(runs[0]?.targetSymbolId).toBe(serviceBRun?.id);
    // Second call outside block resolves to ServiceA.run
    expect(runs[1]?.targetSymbolId).toBe(serviceARun?.id);
  });
});
