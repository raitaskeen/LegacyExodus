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
    expect(analysis.routes[0]?.state).toBe("CONFIRMED");
    expect(analysis.middlewareChains).toEqual([expect.objectContaining({ filePath: "src/server.js", middleware: ["authenticate"] })]);
    expect(analysis.calls.map((call) => call.id)).toEqual([...analysis.calls].map((call) => call.id).sort());
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

  test("uses proven class construction and class context without guessing dynamic receivers", async (): Promise<void> => {
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
    expect(calls.filter((call) => call.calleeName === "this.handle").map((call) => call.targetSymbolId)).toEqual([aHandle?.id]);
    expect(calls.filter((call) => call.calleeName === "a.handle").map((call) => call.targetSymbolId)).toEqual([aHandle?.id]);
    expect(calls.filter((call) => call.calleeName === "unknown.handle").map((call) => call.targetSymbolId)).toEqual([undefined]);
    expect(calls.filter((call) => call.calleeName === "receiver.handle").map((call) => call.targetSymbolId)).toEqual([undefined]);
    expect(analysis.calls.find((call) => call.calleeName === "fn")?.resolutionState).toBe("UNRESOLVED");
    expect(analysis.calls.find((call) => call.calleeName === "unknown.handle")?.resolutionState).toBe("UNRESOLVED");
    expect(analysis.calls.some((call) => call.calleeName.includes("["))).toBe(false);
    expect(repeat.calls).toEqual(analysis.calls);
  });
});
