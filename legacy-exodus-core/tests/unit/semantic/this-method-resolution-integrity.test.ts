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
  // F-002: public `this` dispatch is never proven. app.init.call(router) runs router.format,
  // so neither call may claim a target; they must still never be cross-wired.
  it("Scenario 3 (CONTAINER AFFINITY): never cross-wires same-named container methods; public this dispatch stays UNRESOLVED", async () => {
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
    expect(appCall?.resolutionState).toBe("UNRESOLVED");
    expect(appCall?.targetSymbolId).toBeUndefined();

    expect(routerCall).toBeDefined();
    expect(routerCall?.resolutionState).toBe("UNRESOLVED");
    expect(routerCall?.targetSymbolId).toBeUndefined();
  });

  // --- Defect 3: Anonymous Class Method Resolution --------------------------
  // F-002: an exported class can be subclassed by any importer that overrides start().
  it("Scenario 4 (ANONYMOUS CLASS): keeps overridable this.method() in export default classes UNRESOLVED", async () => {
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
    expect(call?.resolutionState).toBe("UNRESOLVED");
    expect(call?.targetSymbolId).toBeUndefined();
  });

  // --- Nested Function Scope vs Arrow Function Lexical Binding --------------
  // F-002: the arrow and direct calls share init's `this`, which the caller chooses
  // (app.init.call(other)); only the call structure is asserted, never a target.
  it("Scenario 5 (LEXICAL SCOPE): attributes nested, arrow and direct this calls without claiming a public this target", async () => {
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

    expect(arrowCall).toBeDefined();
    expect(arrowCall?.resolutionState).toBe("UNRESOLVED");
    expect(arrowCall?.targetSymbolId).toBeUndefined();

    expect(initCall).toBeDefined();
    expect(initCall?.resolutionState).toBe("UNRESOLVED");
    expect(initCall?.targetSymbolId).toBeUndefined();
  });

  // --- Prototypal Chain & CommonJS Exports ----------------------------------
  // F-002: exported methods are invoked with whatever receiver the importer supplies.
  it("Scenario 6 (COMMONJS EXPORT): keeps this.method() on module.exports receiver methods UNRESOLVED", async () => {
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
    expect(call?.resolutionState).toBe("UNRESOLVED");
    expect(call?.targetSymbolId).toBeUndefined();
  });
});
