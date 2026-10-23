import { describe, expect, it } from "bun:test";

import { DeterministicDependencyGraphBuilder } from "@graph/index";
import { JavaScriptParser } from "@parser/index";
import { DeterministicSemanticAnalysisEngine } from "@semantic/index";
import { JavaScriptSymbolExtractor } from "@symbols/index";

describe("SEM-01: Dynamic & Computed Member Call-Graph Precision & Resolution", () => {
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

  // ─── Case A: String Literal Computed Member Call on Object/Prototype Receiver
  it("Case A1: resolves string literal computed member call on object receiver", async () => {
    const source = `
      const app = {};
      app.init = function() { return 42; };
      app["init"]();
    `;
    const { analysis, symbolTable } = await analyze(source);
    const initSymbol = symbolTable.symbols.find((s) => s.kind === "method" && s.name === "init" && s.containerName === "app");
    expect(initSymbol).toBeDefined();

    const call = analysis.calls.find((c) => c.calleeName === "app.init");
    expect(call).toBeDefined();
    expect(call?.resolutionState).toBe("RESOLVED");
    expect(call?.targetSymbolId).toBe(initSymbol?.id);
  });

  // ─── Case A2: String Literal Computed Member Call on Class Instance Receiver
  it("Case A2: resolves string literal computed member call on class instance receiver", async () => {
    const source = `
      class Router {
        handle() { return 1; }
      }
      const router = new Router();
      router["handle"]();
    `;
    const { analysis, symbolTable } = await analyze(source);
    const handleSymbol = symbolTable.symbols.find((s) => s.kind === "method" && s.name === "handle" && s.containerName === "Router");
    expect(handleSymbol).toBeDefined();

    const call = analysis.calls.find((c) => c.calleeName === "router.handle");
    expect(call).toBeDefined();
    expect(call?.resolutionState).toBe("RESOLVED");
    expect(call?.targetSymbolId).toBe(handleSymbol?.id);
  });

  // ─── Case A3: Contextual 'this' Computed Member Call
  // F-002: the computed key still normalizes to this.defaultConfiguration, but public `this`
  // is chosen by the caller, so the call is not proven to reach app.defaultConfiguration.
  it("Case A3: normalizes a contextual 'this' computed member call without claiming its target", async () => {
    const source = `
      const app = {};
      app.defaultConfiguration = function() { return true; };
      app.init = function() {
        this["defaultConfiguration"]();
      };
    `;
    const { analysis, symbolTable } = await analyze(source);
    const configSymbol = symbolTable.symbols.find((s) => s.kind === "method" && s.name === "defaultConfiguration" && s.containerName === "app");
    expect(configSymbol).toBeDefined();

    const call = analysis.calls.find((c) => c.calleeName === "this.defaultConfiguration");
    expect(call).toBeDefined();
    expect(call?.resolutionState).toBe("UNRESOLVED");
    expect(call?.targetSymbolId).toBeUndefined();
  });

  // ─── Case B: Static Constant Key
  it("Case B1: resolves computed member call using statically known const string key", async () => {
    const source = `
      const KEY = "handle";
      class Service {
        handle() { return "ok"; }
      }
      const service = new Service();
      service[KEY]();
    `;
    const { analysis, symbolTable } = await analyze(source);
    const handleSymbol = symbolTable.symbols.find((s) => s.kind === "method" && s.name === "handle" && s.containerName === "Service");
    expect(handleSymbol).toBeDefined();

    const call = analysis.calls.find((c) => c.calleeName === "service.handle");
    expect(call).toBeDefined();
    expect(call?.resolutionState).toBe("RESOLVED");
    expect(call?.targetSymbolId).toBe(handleSymbol?.id);
  });

  // ─── Case C: Template Literal with No Dynamic Substitution
  it("Case C1: resolves template literal computed member call with no substitutions", async () => {
    const source = `
      const app = {};
      app.init = function() { return 42; };
      app[\`init\`]();
    `;
    const { analysis, symbolTable } = await analyze(source);
    const initSymbol = symbolTable.symbols.find((s) => s.kind === "method" && s.name === "init" && s.containerName === "app");
    expect(initSymbol).toBeDefined();

    const call = analysis.calls.find((c) => c.calleeName === "app.init");
    expect(call).toBeDefined();
    expect(call?.resolutionState).toBe("RESOLVED");
    expect(call?.targetSymbolId).toBe(initSymbol?.id);
  });

  // ─── Case K: Computed Member Invocation with .bind(), .call(), .apply()
  it("Case K1: resolves computed member invocation chained with .bind()", async () => {
    const source = `
      const service = {};
      service.run = function() { return 1; };
      service["run"].bind(service)();
    `;
    const { analysis, symbolTable } = await analyze(source);
    const runSymbol = symbolTable.symbols.find((s) => s.kind === "method" && s.name === "run" && s.containerName === "service");
    expect(runSymbol).toBeDefined();

    const call = analysis.calls.find((c) => c.calleeName === "service.run");
    expect(call).toBeDefined();
    expect(call?.resolutionState).toBe("RESOLVED");
    expect(call?.targetSymbolId).toBe(runSymbol?.id);

    // No phantom bind call
    expect(analysis.calls.filter((c) => c.calleeName.includes(".bind"))).toHaveLength(0);
  });

  it("Case K2: resolves computed member invocation chained with .call() and .apply()", async () => {
    const source = `
      const service = {};
      service.process = function(x) { return x; };
      service["process"].call(service, 1);
      service["process"].apply(service, [2]);
    `;
    const { analysis, symbolTable } = await analyze(source);
    const procSymbol = symbolTable.symbols.find((s) => s.kind === "method" && s.name === "process" && s.containerName === "service");
    expect(procSymbol).toBeDefined();

    const calls = analysis.calls.filter((c) => c.calleeName === "service.process");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.resolutionState).toBe("RESOLVED");
    expect(calls[0]?.targetSymbolId).toBe(procSymbol?.id);
    expect(calls[1]?.resolutionState).toBe("RESOLVED");
    expect(calls[1]?.targetSymbolId).toBe(procSymbol?.id);
  });

  // ─── Case L: Optional Chaining with Computed Member
  it("Case L1: resolves optional chaining computed member call", async () => {
    const source = `
      class Service {
        exec() { return 100; }
      }
      const service = new Service();
      service?.["exec"]?.();
    `;
    const { analysis, symbolTable } = await analyze(source);
    const execSymbol = symbolTable.symbols.find((s) => s.kind === "method" && s.name === "exec" && s.containerName === "Service");
    expect(execSymbol).toBeDefined();

    const call = analysis.calls.find((c) => c.calleeName === "service.exec");
    expect(call).toBeDefined();
    expect(call?.resolutionState).toBe("RESOLVED");
    expect(call?.targetSymbolId).toBe(execSymbol?.id);
  });

  // ─── Case G: Dynamic Key Must NOT Hallucinate Direct Call (Anti-Hallucination)
  it("Case G1 (Anti-Hallucination): dynamic computed key remains unresolved without fabricating property name", async () => {
    const source = `
      function dispatch(obj, method) {
        obj[method]();
      }
    `;
    const { analysis } = await analyze(source);
    const calls = analysis.calls.filter((c) => c.calleeName?.includes("method"));
    expect(calls).toHaveLength(0);
  });

  it("Case G2 (Anti-Hallucination): dynamic expression in template literal remains unresolved", async () => {
    const source = `
      class Service {
        action_v1() {}
      }
      const service = new Service();
      const version = "v1";
      service[\`action_\${version}\`]();
    `;
    const { analysis } = await analyze(source);
    const actionCall = analysis.calls.find((c) => c.calleeName === "service.action_v1");
    expect(actionCall).toBeUndefined();
  });

  // ─── Case H: Unknown Receiver with Computed Key Must NOT Fabricate Receiver Target
  it("Case H1 (Anti-Hallucination): unknown receiver with computed key remains UNRESOLVED", async () => {
    const source = `
      class Service {
        run() {}
      }
      getObject()["run"]();
    `;
    const { analysis, symbolTable } = await analyze(source);
    const runSymbol = symbolTable.symbols.find((s) => s.kind === "method" && s.name === "run");
    expect(runSymbol).toBeDefined();

    const calls = analysis.calls.filter((c) => c.targetSymbolId === runSymbol?.id);
    expect(calls).toHaveLength(0);
  });

  // ─── Case I: Wrong Key Must NOT Resolve to Unrelated Method
  it("Case I1 (Anti-Hallucination): non-existent computed key on known receiver remains UNRESOLVED", async () => {
    const source = `
      class Service {
        run() {}
      }
      const service = new Service();
      service["nonExistent"]();
    `;
    const { analysis, symbolTable } = await analyze(source);
    const runSymbol = symbolTable.symbols.find((s) => s.kind === "method" && s.name === "run");
    expect(runSymbol).toBeDefined();

    const nonExistentCall = analysis.calls.find((c) => c.calleeName === "service.nonExistent");
    expect(nonExistentCall).toBeDefined();
    expect(nonExistentCall?.resolutionState).toBe("UNRESOLVED");
    expect(nonExistentCall?.targetSymbolId).toBeUndefined();
  });

  // ─── Case J: Shadowed Constant Key Isolation
  it("Case J1 (Anti-Hallucination): shadowed constant key does not leak outer value into parameter scope", async () => {
    const source = `
      const KEY = "run";
      class Service {
        run() {}
      }
      const service = new Service();
      function wrapper(KEY) {
        service[KEY]();
      }
    `;
    const { analysis, symbolTable } = await analyze(source);
    const runSymbol = symbolTable.symbols.find((s) => s.kind === "method" && s.name === "run");
    expect(runSymbol).toBeDefined();

    const wrapperCall = analysis.calls.find((c) => c.callerName === "wrapper");
    expect(wrapperCall?.targetSymbolId).toBeUndefined();
    expect(wrapperCall?.resolutionState !== "RESOLVED" || wrapperCall === undefined).toBe(true);
  });

  // ─── Case M: Cross-File Imported Namespace Member with Computed Access ─────
  it("Case M1: resolves imported namespace computed member call across files", async () => {
    const apiFile = { id: "api", path: "src/api.js", language: "javascript", size: 50 };
    const indexFile = { id: "index", path: "src/index.js", language: "javascript", size: 100 };

    const apiSource = `
      export function ping() { return "pong"; }
    `;
    const indexSource = `
      import * as api from "./api";
      function start() {
        api["ping"]();
      }
    `;

    const apiAst = (await parser.parse({ file: apiFile, source: apiSource })).result!;
    const indexAst = (await parser.parse({ file: indexFile, source: indexSource })).result!;

    const apiSymbols = extractor.extract(apiAst);
    const indexSymbols = extractor.extract(indexAst);

    const depGraph = depBuilder.build([apiSymbols, indexSymbols], [apiFile, indexFile]);
    const analysis = engine.analyze({
      astResults: [apiAst, indexAst],
      dependencyGraph: depGraph,
      symbolTables: [apiSymbols, indexSymbols],
    });

    const pingExportSymbol = apiSymbols.symbols.find((s) => s.kind === "export" && s.name === "ping");
    expect(pingExportSymbol).toBeDefined();

    const call = analysis.calls.find((c) => c.calleeName === "api.ping");
    expect(call).toBeDefined();
    expect(call?.resolutionState).toBe("RESOLVED");
    expect(call?.targetSymbolId).toBe(pingExportSymbol?.id);
  });

  // ─── Determinism Verification ─────────────────────────────────────────────
  it("Scenario Determinism: produces identical call graph IDs and targets across repeated runs", async () => {
    const source = `
      class Service {
        exec() { return 100; }
      }
      const KEY = "exec";
      const service = new Service();
      service["exec"]();
      service[KEY]();
      service?.["exec"]?.();
    `;
    const run1 = await analyze(source);
    const run2 = await analyze(source);

    expect(run1.analysis.calls.map((c) => ({ id: c.id, callee: c.calleeName, state: c.resolutionState, target: c.targetSymbolId })))
      .toEqual(run2.analysis.calls.map((c) => ({ id: c.id, callee: c.calleeName, state: c.resolutionState, target: c.targetSymbolId })));
  });
});
