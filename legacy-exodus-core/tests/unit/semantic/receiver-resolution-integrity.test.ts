import { describe, expect, it } from "bun:test";

import { DeterministicDependencyGraphBuilder } from "@graph/index";
import { JavaScriptParser } from "@parser/index";
import { DeterministicSemanticAnalysisEngine } from "@semantic/index";
import { JavaScriptSymbolExtractor } from "@symbols/index";

describe("P1 Task 9: Semantic Receiver Resolution Integrity & Anti-Hallucination", () => {
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

  // ─── Positive Scenarios ───────────────────────────────────────────────────
  describe("Positive Receiver Resolutions (Strong Evidence)", () => {
    it("resolves exact receiver-matched prototype/object declarations (e.g. app.init)", async () => {
      const source = `
        const app = {};
        app.init = function() { return 42; };
        app.init();
      `;
      const { analysis, symbolTable } = await analyze(source);
      const initSymbol = symbolTable.symbols.find((s) => s.kind === "method" && s.name === "init" && s.containerName === "app");
      const initCall = analysis.calls.find((c) => c.calleeName === "app.init");

      expect(initSymbol).toBeDefined();
      expect(initCall?.resolutionState).toBe("RESOLVED");
      expect(initCall?.targetSymbolId).toBe(initSymbol?.id);
    });

    it("resolves contextual 'this' calls to prototype methods on the same container", async () => {
      const source = `
        const app = {};
        app.defaultConfiguration = function() { return true; };
        app.init = function() {
          this.defaultConfiguration();
        };
      `;
      const { analysis, symbolTable } = await analyze(source);
      const configSymbol = symbolTable.symbols.find((s) => s.kind === "method" && s.name === "defaultConfiguration" && s.containerName === "app");
      const configCall = analysis.calls.find((c) => c.calleeName === "this.defaultConfiguration");

      expect(configSymbol).toBeDefined();
      expect(configCall?.resolutionState).toBe("RESOLVED");
      expect(configCall?.targetSymbolId).toBe(configSymbol?.id);
    });

    it("resolves class instance constructor-instantiated methods", async () => {
      const source = `
        class Router {
          handle() { return 1; }
        }
        const router = new Router();
        router.handle();
      `;
      const { analysis, symbolTable } = await analyze(source);
      const handleSymbol = symbolTable.symbols.find((s) => s.kind === "method" && s.name === "handle" && s.containerName === "Router");
      const handleCall = analysis.calls.find((c) => c.calleeName === "router.handle");

      expect(handleSymbol).toBeDefined();
      expect(handleCall?.resolutionState).toBe("RESOLVED");
      expect(handleCall?.targetSymbolId).toBe(handleSymbol?.id);
    });
  });

  // ─── Negative Scenarios (Anti-Hallucination & Conservative Fallback) ──────
  describe("Negative Receiver Scenarios (Anti-Hallucination)", () => {
    it("Case A: leaves unrelated app.init UNRESOLVED even if proto.init exists in file", async () => {
      const source = `
        const proto = {};
        proto.init = function() { return 1; };
        const app = someUnrelatedFactory();
        app.init();
      `;
      const { analysis } = await analyze(source);
      const appInitCall = analysis.calls.find((c) => c.calleeName === "app.init");

      expect(appInitCall?.resolutionState).toBe("UNRESOLVED");
      expect(appInitCall?.targetSymbolId).toBeUndefined();
    });

    it("Case B: does NOT cross-match req.send to res.send in the same file", async () => {
      const source = `
        const res = {};
        res.send = function(data) { return data; };
        const req = createRequest();
        req.send();
      `;
      const { analysis } = await analyze(source);
      const reqSendCall = analysis.calls.find((c) => c.calleeName === "req.send");

      expect(reqSendCall?.resolutionState).toBe("UNRESOLVED");
      expect(reqSendCall?.targetSymbolId).toBeUndefined();
    });

    it("Case C: leaves unrelated res.json UNRESOLVED when no declaration exists", async () => {
      const source = `
        const res = createResponse();
        res.json({ ok: true });
      `;
      const { analysis } = await analyze(source);
      const resJsonCall = analysis.calls.find((c) => c.calleeName === "res.json");

      expect(resJsonCall?.resolutionState).toBe("UNRESOLVED");
      expect(resJsonCall?.targetSymbolId).toBeUndefined();
    });

    it("Case D: does NOT cross-match proto.handle to app.handle in the same file", async () => {
      const source = `
        const app = {};
        app.handle = function(req, res) {};
        const proto = somethingElse;
        proto.handle();
      `;
      const { analysis } = await analyze(source);
      const protoHandleCall = analysis.calls.find((c) => c.calleeName === "proto.handle");

      expect(protoHandleCall?.resolutionState).toBe("UNRESOLVED");
      expect(protoHandleCall?.targetSymbolId).toBeUndefined();
    });

    it("Case G: preserves lexical scope isolation when receiver is shadowed", async () => {
      const source = `
        const proto = {};
        proto.use = function() {};
        function outer(app) {
          function inner() {
            const app = unrelated();
            app.use();
          }
        }
      `;
      const { analysis } = await analyze(source);
      const innerAppUseCall = analysis.calls.find((c) => c.callerName === "inner" && c.calleeName === "app.use");

      expect(innerAppUseCall?.resolutionState).toBe("UNRESOLVED");
      expect(innerAppUseCall?.targetSymbolId).toBeUndefined();
    });

    it("Case H: leaves ambiguous receivers UNRESOLVED when multiple containers declare the same method", async () => {
      const source = `
        const proto1 = {};
        proto1.run = function() {};
        const proto2 = {};
        proto2.run = function() {};
        function execute() {
          this.run();
        }
      `;
      const { analysis } = await analyze(source);
      const thisRunCall = analysis.calls.find((c) => c.calleeName === "this.run");

      expect(thisRunCall?.resolutionState).toBe("UNRESOLVED");
      expect(thisRunCall?.targetSymbolId).toBeUndefined();
    });

    it("Case I: ignores dynamic computed property invocations obj[name]()", async () => {
      const source = `
        const name = getName();
        obj[name]();
      `;
      const { analysis } = await analyze(source);
      const calls = analysis.calls.map((c) => c.calleeName);

      expect(calls).not.toContain("obj[name]");
      expect(analysis.calls.find((c) => c.calleeName === "getName")?.resolutionState).toBe("UNRESOLVED");
    });
  });

  // ─── Determinism ─────────────────────────────────────────────────────────
  describe("Semantic Determinism", () => {
    it("produces byte-identical semantic analysis results across multiple repeat executions", async () => {
      const source = `
        class Service {
          process() { return 1; }
        }
        const svc = new Service();
        svc.process();
        const app = {};
        app.listen = function() {};
        app.listen(8080);
      `;
      const res1 = await analyze(source);
      const res2 = await analyze(source);

      expect(res1.analysis.calls).toEqual(res2.analysis.calls);
      expect(res1.analysis.references).toEqual(res2.analysis.references);
      expect(res1.analysis.routes).toEqual(res2.analysis.routes);
    });
  });
});
