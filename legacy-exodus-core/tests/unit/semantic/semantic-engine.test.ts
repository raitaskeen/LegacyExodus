import { describe, expect, test } from "bun:test";

import { DeterministicDependencyGraphBuilder } from "@graph/index";
import { JavaScriptParser } from "@parser/index";
import { DeterministicSemanticAnalysisEngine } from "@semantic/index";
import { JavaScriptSymbolExtractor } from "@symbols/index";

describe("DeterministicSemanticAnalysisEngine", () => {
  test("derives deterministic calls, references, scopes, findings, entry points, routes, and middleware", async (): Promise<void> => {
    const parser = new JavaScriptParser();
    const extractor = new JavaScriptSymbolExtractor();
    const files = [
      { id: "server", path: "src/server.js", language: "javascript", size: 1 },
      { id: "auth", path: "src/auth.js", language: "javascript", size: 1 },
    ] as const;
    const serverSource = `
      import express from "express";
      import { login } from "./auth";
      const unused = true;
      function handler() { return login(); }
      const app = express();
      app.use(authenticate);
      app.get("/books", authenticate, handler);
      app.listen(3000);
    `;
    const authSource = "export function login() { return true; }";
    const serverAst = (await parser.parse({ file: files[0], source: serverSource })).result;
    const authAst = (await parser.parse({ file: files[1], source: authSource })).result;
    const serverSymbols = extractor.extract(serverAst);
    const authSymbols = extractor.extract(authAst);
    const dependencyGraph = new DeterministicDependencyGraphBuilder().build([serverSymbols, authSymbols], files);
    const analysis = new DeterministicSemanticAnalysisEngine().analyze({
      astResults: [serverAst, authAst],
      dependencyGraph,
      symbolTables: [serverSymbols, authSymbols],
    });

    expect(analysis.calls.some((call) => call.callerName === "handler" && call.calleeName === "login" && call.targetSymbolId !== undefined)).toBe(true);
    expect(analysis.references.some((reference) => reference.name === "login" && reference.resolvedSymbolId !== undefined)).toBe(true);
    expect(analysis.scopes[0]?.name).toBe("module");
    expect(analysis.deadCode.some((finding) => finding.name === "unused")).toBe(true);
    expect(analysis.entryPoints.some((entry) => entry.filePath === "src/server.js")).toBe(true);
    expect(analysis.routes).toEqual([expect.objectContaining({ filePath: "src/server.js", method: "GET", path: "/books" })]);
    // INFERRED until per-router middleware, handler and mount paths are modelled (BA-08).
    expect(analysis.routes[0]?.state).toBe("INFERRED");
    expect(analysis.middlewareChains).toEqual([expect.objectContaining({ filePath: "src/server.js", middleware: ["authenticate"] })]);
    // Ordered by structural key (ADR-008): file, owners, kind and ordinal.
    expect(analysis.calls.map((call) => call.key ?? call.id)).toEqual([...analysis.calls].map((call) => call.key ?? call.id).sort());
    expect(Object.isFrozen(analysis)).toBe(true);
  });

  test("requires an Express app or router receiver before recording routes", async (): Promise<void> => {
    const parser = new JavaScriptParser();
    const source = "const axios = createClient(); const customClient = createClient(); axios.get('/remote'); customClient.post('/books'); cache.get('book');";
    const ast = (await parser.parse({ file: { id: "clients", path: "src/clients.js", language: "javascript", size: source.length }, source })).result;
    const symbols = new JavaScriptSymbolExtractor().extract(ast);
    const graph = new DeterministicDependencyGraphBuilder().build([symbols], [{ id: "clients", path: "src/clients.js", language: "javascript", size: 1 }]);
    const analysis = new DeterministicSemanticAnalysisEngine().analyze({ astResults: [ast], dependencyGraph: graph, symbolTables: [symbols] });

    expect(analysis.routes).toEqual([]);
  });

  test("does not confirm Express semantics from a locally named factory", async (): Promise<void> => {
    const source = `
      const express = customThing;
      const app = express();
      function handler(_request, response) { response.end("ok"); }
      app.use(localMiddleware);
      app.get("/x", handler);
      const Router = customThing;
      const router = Router();
      router.post("/y", handler);
    `;
    const file = { id: "framework-collision", path: "src/framework-collision.js", language: "javascript", size: source.length } as const;
    const ast = (await new JavaScriptParser().parse({ file, source })).result;
    const symbols = new JavaScriptSymbolExtractor().extract(ast);
    const graph = new DeterministicDependencyGraphBuilder().build([symbols], [file]);
    const analysis = new DeterministicSemanticAnalysisEngine().analyze({ astResults: [ast], dependencyGraph: graph, symbolTables: [symbols] });

    expect(analysis.routes).toEqual([]);
    expect(analysis.middlewareChains).toEqual([]);
  });

  test("does not confirm Express semantics from a shadowed framework binding", async (): Promise<void> => {
    const source = `
      import express from "express";
      function register() {
        const express = customThing;
        const app = express();
        app.get("/shadowed", handler);
      }
    `;
    const file = { id: "framework-shadow", path: "src/framework-shadow.js", language: "javascript", size: source.length } as const;
    const ast = (await new JavaScriptParser().parse({ file, source })).result;
    const symbols = new JavaScriptSymbolExtractor().extract(ast);
    const graph = new DeterministicDependencyGraphBuilder().build([symbols], [file]);
    const analysis = new DeterministicSemanticAnalysisEngine().analyze({ astResults: [ast], dependencyGraph: graph, symbolTables: [symbols] });

    expect(analysis.routes).toEqual([]);
    expect(analysis.middlewareChains).toEqual([]);
  });

  test("keeps genuine module provenance outside an unrelated shadowed scope", async (): Promise<void> => {
    const source = `
      import express from "express";
      const app = express();
      app.get("/real", realHandler);
      function registerFake() {
        const express = customThing;
        const app = express();
        app.get("/fake", fakeHandler);
      }
    `;
    const file = { id: "framework-scope", path: "src/framework-scope.js", language: "javascript", size: source.length } as const;
    const ast = (await new JavaScriptParser().parse({ file, source })).result;
    const symbols = new JavaScriptSymbolExtractor().extract(ast);
    const graph = new DeterministicDependencyGraphBuilder().build([symbols], [file]);
    const analysis = new DeterministicSemanticAnalysisEngine().analyze({ astResults: [ast], dependencyGraph: graph, symbolTables: [symbols] });

    expect(analysis.routes.map((route) => ({ path: route.path, state: route.state }))).toEqual([
      { path: "/real", state: "INFERRED" },
    ]);
  });

  test("records routes from a CommonJS Express binding", async (): Promise<void> => {
    const source = `
      const express = require("express");
      const app = express();
      app.get("/commonjs", handler);
    `;
    const file = { id: "framework-commonjs", path: "src/framework-commonjs.js", language: "javascript", size: source.length } as const;
    const ast = (await new JavaScriptParser().parse({ file, source })).result;
    const symbols = new JavaScriptSymbolExtractor().extract(ast);
    const graph = new DeterministicDependencyGraphBuilder().build([symbols], [file]);
    const analysis = new DeterministicSemanticAnalysisEngine().analyze({ astResults: [ast], dependencyGraph: graph, symbolTables: [symbols] });

    expect(analysis.routes.map((route) => ({ method: route.method, path: route.path, state: route.state }))).toEqual([
      { method: "GET", path: "/commonjs", state: "INFERRED" },
    ]);
  });

  test("resolves nested lexical bindings by their exact scope and preserves shadowing", async (): Promise<void> => {
    const source = `
      function outer() {
        function handle() { return "outer"; }
        return handle();
      }
      function other() {
        function handle() { return "other"; }
        return handle();
      }
      function shadowed() {
        function handle() { return "outer"; }
        { function handle() { return "inner"; } handle(); }
      }
    `;
    const file = { id: "lexical", path: "src/lexical.js", language: "javascript", size: source.length } as const;
    const ast = (await new JavaScriptParser().parse({ file, source })).result;
    const symbols = new JavaScriptSymbolExtractor().extract(ast);
    const graph = new DeterministicDependencyGraphBuilder().build([symbols], [file]);
    const analysis = new DeterministicSemanticAnalysisEngine().analyze({ astResults: [ast], dependencyGraph: graph, symbolTables: [symbols] });
    const handles = symbols.symbols
      .filter((symbol) => symbol.kind === "function" && symbol.name === "handle")
      .sort((left, right) => (left.location?.start.line ?? 0) - (right.location?.start.line ?? 0));
    const [outerHandle, otherHandle, shadowedOuterHandle, innerHandle] = handles;
    const outerCall = analysis.calls.find((call) => call.callerName === "outer" && call.calleeName === "handle");
    const otherCall = analysis.calls.find((call) => call.callerName === "other" && call.calleeName === "handle");
    const shadowedCall = analysis.calls.find((call) => call.callerName === "shadowed" && call.calleeName === "handle");

    expect(outerHandle?.id).toBeDefined();
    expect(otherHandle?.id).toBeDefined();
    expect(shadowedOuterHandle?.id).toBeDefined();
    expect(innerHandle?.id).toBeDefined();
    expect(outerCall?.targetSymbolId).toBe(outerHandle?.id);
    expect(otherCall?.targetSymbolId).toBe(otherHandle?.id);
    expect(shadowedCall?.targetSymbolId).toBe(innerHandle?.id);
    expect(shadowedCall?.targetSymbolId).not.toBe(shadowedOuterHandle?.id);
  });

  // F-002: only class construction proves a receiver; `this` inside invoke() is chosen by the
  // caller (A.prototype.invoke.call(new B()) runs B's handle), so it is not a proof.
  test("uses proven class construction without guessing class-context or dynamic receivers", async (): Promise<void> => {
    const source = `
      class A { handle() {} invoke() { return this.handle(); } }
      class B { handle() {} }
      const a = new A();
      a.handle();
      const unknown = unknownFactory();
      unknown.handle();
      const fn = getUnknownFunction();
      fn();
      const receiver = condition ? new A() : new B();
      receiver.handle();
      unknown["handle"]();
    `;
    const file = { id: "containers", path: "src/containers.js", language: "javascript", size: source.length } as const;
    const ast = (await new JavaScriptParser().parse({ file, source })).result;
    const symbols = new JavaScriptSymbolExtractor().extract(ast);
    const graph = new DeterministicDependencyGraphBuilder().build([symbols], [file]);
    const engine = new DeterministicSemanticAnalysisEngine();
    const analysis = engine.analyze({ astResults: [ast], dependencyGraph: graph, symbolTables: [symbols] });
    const repeat = engine.analyze({ astResults: [ast], dependencyGraph: graph, symbolTables: [symbols] });
    const aHandle = symbols.symbols.find((symbol) => symbol.kind === "method" && symbol.name === "handle" && symbol.containerName === "A");
    const calls = analysis.calls.filter((call) => call.calleeName.endsWith(".handle"));

    expect(aHandle?.id).toBeDefined();
    expect(calls.filter((call) => call.calleeName === "this.handle").map((call) => call.targetSymbolId)).toEqual([undefined]);
    expect(calls.filter((call) => call.calleeName === "a.handle").map((call) => call.targetSymbolId)).toEqual([aHandle?.id]);
    expect(calls.filter((call) => call.calleeName === "unknown.handle").map((call) => call.targetSymbolId)).toEqual([undefined]);
    expect(calls.filter((call) => call.calleeName === "receiver.handle").map((call) => call.targetSymbolId)).toEqual([undefined]);
    expect(analysis.calls.find((call) => call.calleeName === "fn")?.resolutionState).toBe("UNRESOLVED");
    expect(analysis.calls.find((call) => call.calleeName === "unknown.handle")?.resolutionState).toBe("UNRESOLVED");
    expect(analysis.calls.some((call) => call.calleeName.includes("["))).toBe(false);
    expect(repeat.calls).toEqual(analysis.calls);
  });

  test("keeps object-method calls unresolved without receiver construction evidence", async (): Promise<void> => {
    const source = "const service = { getUser(req, res) { return res.send(req.params.id); } }; service.getUser(); const unknown = getService(); unknown.getUser();";
    const file = { id: "object-method", path: "src/object-method.js", language: "javascript", size: source.length } as const;
    const ast = (await new JavaScriptParser().parse({ file, source })).result;
    const symbols = new JavaScriptSymbolExtractor().extract(ast);
    const graph = new DeterministicDependencyGraphBuilder().build([symbols], [file]);
    const analysis = new DeterministicSemanticAnalysisEngine().analyze({ astResults: [ast], dependencyGraph: graph, symbolTables: [symbols] });
    const method = symbols.symbols.find((symbol) => symbol.kind === "method" && symbol.name === "getUser");

    expect(method?.parameters).toEqual(["req", "res"]);
    expect(analysis.calls.filter((call) => call.calleeName === "service.getUser").map((call) => call.resolutionState)).toEqual(["UNRESOLVED"]);
    expect(analysis.calls.filter((call) => call.calleeName === "unknown.getUser").map((call) => call.targetSymbolId)).toEqual([undefined]);
  });

  test("isolates sibling scopes and correctly resolves module-level bindings", async (): Promise<void> => {
    const source = `
      function moduleHelper() { return "module"; }
      function caller() {
        privateHelper();
        moduleHelper();
      }
      function container() {
        function privateHelper() { return "private"; }
        privateHelper();
      }
    `;
    const file = { id: "lexical-isolation", path: "src/lexical-isolation.js", language: "javascript", size: source.length } as const;
    const ast = (await new JavaScriptParser().parse({ file, source })).result;
    const symbols = new JavaScriptSymbolExtractor().extract(ast);
    const graph = new DeterministicDependencyGraphBuilder().build([symbols], [file]);
    const analysis = new DeterministicSemanticAnalysisEngine().analyze({ astResults: [ast], dependencyGraph: graph, symbolTables: [symbols] });

    const moduleHelperSymbol = symbols.symbols.find((s) => s.kind === "function" && s.name === "moduleHelper" && s.scopeId === "scope:module");
    const privateHelperSymbol = symbols.symbols.find((s) => s.kind === "function" && s.name === "privateHelper");

    const callerCalls = analysis.calls.filter((c) => c.callerName === "caller");
    const containerCalls = analysis.calls.filter((c) => c.callerName === "container");

    const callerPrivateCall = callerCalls.find((c) => c.calleeName === "privateHelper");
    const callerModuleCall = callerCalls.find((c) => c.calleeName === "moduleHelper");
    const containerPrivateCall = containerCalls.find((c) => c.calleeName === "privateHelper");

    expect(callerPrivateCall?.resolutionState).toBe("UNRESOLVED");
    expect(callerPrivateCall?.targetSymbolId).toBeUndefined();

    expect(callerModuleCall?.resolutionState).toBe("RESOLVED");
    expect(callerModuleCall?.targetSymbolId).toBe(moduleHelperSymbol?.id);

    expect(containerPrivateCall?.resolutionState).toBe("RESOLVED");
    expect(containerPrivateCall?.targetSymbolId).toBe(privateHelperSymbol?.id);
  });

  test("resolves renamed and multiple aliased imports to their exact canonical target export symbols", async (): Promise<void> => {
    const parser = new JavaScriptParser();
    const extractor = new JavaScriptSymbolExtractor();
    const files = [
      { id: "service", path: "src/service.js", language: "javascript", size: 1 },
      { id: "consumer", path: "src/consumer.js", language: "javascript", size: 1 },
    ] as const;
    const serviceSource = `
      export function actualA() { return "A"; }
      export function actualB() { return "B"; }
    `;
    const consumerSource = `
      import { actualA as aliasA, actualB as aliasB } from "./service";
      function run() {
        aliasA();
        aliasB();
        unrelatedLocal();
      }
    `;
    const serviceAst = (await parser.parse({ file: files[0], source: serviceSource })).result;
    const consumerAst = (await parser.parse({ file: files[1], source: consumerSource })).result;
    const serviceSymbols = extractor.extract(serviceAst);
    const consumerSymbols = extractor.extract(consumerAst);
    const dependencyGraph = new DeterministicDependencyGraphBuilder().build([serviceSymbols, consumerSymbols], files);
    const analysis = new DeterministicSemanticAnalysisEngine().analyze({
      astResults: [serviceAst, consumerAst],
      dependencyGraph,
      symbolTables: [serviceSymbols, consumerSymbols],
    });

    const exportA = serviceSymbols.symbols.find((s) => s.kind === "export" && s.name === "actualA");
    const exportB = serviceSymbols.symbols.find((s) => s.kind === "export" && s.name === "actualB");

    const callA = analysis.calls.find((c) => c.sourceFilePath === "src/consumer.js" && c.calleeName === "aliasA");
    const callB = analysis.calls.find((c) => c.sourceFilePath === "src/consumer.js" && c.calleeName === "aliasB");
    const callUnrelated = analysis.calls.find((c) => c.sourceFilePath === "src/consumer.js" && c.calleeName === "unrelatedLocal");

    expect(exportA?.id).toBeDefined();
    expect(exportB?.id).toBeDefined();

    expect(callA?.resolutionState).toBe("RESOLVED");
    expect(callA?.targetSymbolId).toBe(exportA?.id);

    expect(callB?.resolutionState).toBe("RESOLVED");
    expect(callB?.targetSymbolId).toBe(exportB?.id);

    expect(callUnrelated?.resolutionState).toBe("UNRESOLVED");
    expect(callUnrelated?.targetSymbolId).toBeUndefined();
  });
});
