import { describe, expect, it } from "bun:test";

import { JavaScriptParser } from "@parser/adapters/javascript/javascript-parser";
import { JavaScriptSymbolExtractor } from "@symbols/javascript-symbol-extractor";
import { DeterministicDependencyGraphBuilder } from "@graph/dependency-graph-builder";
import { DeterministicSemanticAnalysisEngine } from "@semantic/semantic-engine";

describe("FINDING-SEM-02: Constructor Call Resolution", () => {
  const parser = new JavaScriptParser();
  const extractor = new JavaScriptSymbolExtractor();
  const depBuilder = new DeterministicDependencyGraphBuilder();
  const semanticEngine = new DeterministicSemanticAnalysisEngine();

  async function analyzeCode(source: string, filePath = "service.js") {
    const parseResult = (await parser.parse({
      file: { id: "1", path: filePath, language: "javascript", size: source.length },
      source,
    })).result;
    const symbolTable = extractor.extract(parseResult);
    const depGraph = depBuilder.build([symbolTable], [{ id: "1", path: filePath, language: "javascript", size: source.length }]);
    const analysis = semanticEngine.analyze({
      astResults: [parseResult],
      symbolTables: [symbolTable],
      dependencyGraph: depGraph,
    });
    return { parseResult, symbolTable, analysis };
  }

  it("resolves new ClassName() constructor instantiation to local class symbol", async () => {
    const code = `
      class UserService {
        findUser(id) { return id; }
      }
      const service = new UserService();
      service.findUser(1);
    `;
    const { symbolTable, analysis } = await analyzeCode(code);

    const classSymbol = symbolTable.symbols.find((s) => s.kind === "class" && s.name === "UserService");
    expect(classSymbol).toBeDefined();

    const constructorCall = analysis.calls.find((c) => c.calleeName === "UserService");
    expect(constructorCall).toBeDefined();
    expect(constructorCall?.resolutionState).toBe("RESOLVED");
    expect(constructorCall?.targetSymbolId).toBe(classSymbol?.id);

    const constructorRef = analysis.references.find((r) => r.name === "UserService" && r.kind === "call");
    expect(constructorRef).toBeDefined();
    expect(constructorRef?.resolutionState).toBe("RESOLVED");
    expect(constructorRef?.resolvedSymbolId).toBe(classSymbol?.id);
  });

  it("does not flag unexported instantiated class as unreferenced dead code", async () => {
    const code = `
      class InternalCache {
        clear() {}
      }
      const cache = new InternalCache();
      cache.clear();
    `;
    const { symbolTable, analysis } = await analyzeCode(code);

    const classSymbol = symbolTable.symbols.find((s) => s.kind === "class" && s.name === "InternalCache");
    expect(classSymbol).toBeDefined();

    const deadClass = analysis.deadCode.find((d) => d.name === "InternalCache");
    expect(deadClass).toBeUndefined();
  });
});
