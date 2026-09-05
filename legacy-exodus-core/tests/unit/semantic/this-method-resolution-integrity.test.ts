import { describe, expect, it } from "bun:test";

import { DeterministicDependencyGraphBuilder } from "@graph/index";
import { JavaScriptParser } from "@parser/index";
import { DeterministicSemanticAnalysisEngine } from "@semantic/index";
import { JavaScriptSymbolExtractor } from "@symbols/index";

describe("SEM-08: Contextual this.method() Call Resolution Integrity", () => {
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

  // --- Defect 1: Anti-Hallucination in Standalone Functions -----------------
  it("Scenario 1 (ANTI-HALLUCINATION): standalone function calling this.method() remains UNRESOLVED despite object method in same file", async () => {
    const source = `
      const app = {};
      app.format = function() { return 1; };

      function standalone() {
        this.format();
      }
    `;
    const { analysis, symbolTable } = await analyze(source);
    const appFormat = symbolTable.symbols.find((s) => s.kind === "method" && s.name === "format" && s.containerName === "app");
    expect(appFormat).toBeDefined();

    const call = analysis.calls.find((c) => c.callerName === "standalone" && c.calleeName === "this.format");
    expect(call).toBeDefined();
    // MUST NOT resolve to app.format
    expect(call?.resolutionState).toBe("UNRESOLVED");
    expect(call?.targetSymbolId).toBeUndefined();
  });

  it("Scenario 2 (ANTI-HALLUCINATION): top-level module calling this.method() remains UNRESOLVED", async () => {
    const source = `
      const app = {};
      app.format = function() { return 1; };

      this.format();
    `;
    const { analysis } = await analyze(source);
    const call = analysis.calls.find((c) => c.calleeName === "this.format");
    expect(call).toBeDefined();
    expect(call?.resolutionState).toBe("UNRESOLVED");
    expect(call?.targetSymbolId).toBeUndefined();
  });

  // --- Defect 2: Multi-Container Disambiguation -----------------------------
  it("Scenario 3 (CONTAINER AFFINITY): disambiguates same-named methods across distinct object containers", async () => {
    const source = `
      const app = {};
      app.format = function() { return "app"; };
      app.init = function() {
        this.format();
      };

      const router = {};
      router.format = function() { return "router"; };
      router.handle = function() {
        this.format();
      };
    `;
    const { analysis, symbolTable } = await analyze(source);
    const appFormat = symbolTable.symbols.find((s) => s.kind === "method" && s.name === "format" && s.containerName === "app");
    const routerFormat = symbolTable.symbols.find((s) => s.kind === "method" && s.name === "format" && s.containerName === "router");

    expect(appFormat).toBeDefined();
    expect(routerFormat).toBeDefined();

    const appCall = analysis.calls.find((c) => c.callerName === "init" && c.calleeName === "this.format");
    const routerCall = analysis.calls.find((c) => c.callerName === "handle" && c.calleeName === "this.format");

    expect(appCall).toBeDefined();
    expect(appCall?.resolutionState).toBe("RESOLVED");
    expect(appCall?.targetSymbolId).toBe(appFormat?.id);

    expect(routerCall).toBeDefined();
    expect(routerCall?.resolutionState).toBe("RESOLVED");
    expect(routerCall?.targetSymbolId).toBe(routerFormat?.id);
  });

  // --- Defect 3: Anonymous Class Method Resolution --------------------------
  it("Scenario 4 (ANONYMOUS CLASS): resolves this.method() in export default class declarations", async () => {
    const source = `
      export default class {
        start() { return 1; }
        run() {
          this.start();
        }
      }
    `;
    const { analysis, symbolTable } = await analyze(source);
    const startMethod = symbolTable.symbols.find((s) => s.kind === "method" && s.name === "start");
    expect(startMethod).toBeDefined();

    const call = analysis.calls.find((c) => c.callerName === "run" && c.calleeName === "this.start");
    expect(call).toBeDefined();
    expect(call?.resolutionState).toBe("RESOLVED");
    expect(call?.targetSymbolId).toBe(startMethod?.id);
  });

  // --- Nested Function Scope vs Arrow Function Lexical Binding --------------
  it("Scenario 5 (LEXICAL SCOPE): isolates nested regular function this while preserving arrow function this in object methods", async () => {
    const source = `
      const app = {};
      app.format = function() { return 1; };
      app.init = function() {
        function nested() {
          this.format();
        }
        const arrow = () => {
          this.format();
        };
        this.format();
      };
    `;
    const { analysis, symbolTable } = await analyze(source);
    const appFormat = symbolTable.symbols.find((s) => s.kind === "method" && s.name === "format" && s.containerName === "app");
    expect(appFormat).toBeDefined();

    const calls = analysis.calls.filter((c) => c.calleeName === "this.format");
    expect(calls.length).toBe(3);

    const nestedCall = calls.find((c) => c.callerName === "nested");
    const arrowCall = calls.find((c) => c.callerName === "arrow" || (c.callerName === "init" && c.location?.line === 9));
    const initCall = calls.find((c) => c.callerName === "init" && c.location?.line === 11);

    expect(nestedCall?.resolutionState).toBe("UNRESOLVED");
    expect(nestedCall?.targetSymbolId).toBeUndefined();

    expect(arrowCall?.resolutionState).toBe("RESOLVED");
    expect(arrowCall?.targetSymbolId).toBe(appFormat?.id);

    expect(initCall?.resolutionState).toBe("RESOLVED");
    expect(initCall?.targetSymbolId).toBe(appFormat?.id);
  });

  // --- Prototypal Chain & CommonJS Exports ----------------------------------
  it("Scenario 6 (COMMONJS EXPORT): resolves this.method() on module.exports receiver methods", async () => {
    const source = `
      module.exports.setup = function() { return true; };
      module.exports.init = function() {
        this.setup();
      };
    `;
    const { analysis, symbolTable } = await analyze(source);
    const setupSymbol = symbolTable.symbols.find((s) => s.name === "setup" && s.containerName?.includes("exports"));
    expect(setupSymbol).toBeDefined();

    const call = analysis.calls.find((c) => c.calleeName === "this.setup");
    expect(call).toBeDefined();
    expect(call?.resolutionState).toBe("RESOLVED");
    expect(call?.targetSymbolId).toBe(setupSymbol?.id);
  });
});
