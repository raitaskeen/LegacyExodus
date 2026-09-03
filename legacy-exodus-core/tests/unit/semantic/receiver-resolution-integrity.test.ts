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

    it("Case G2: prevents outer class instance receiver from leaking into shadowed variable scope", async () => {
      const source = `
        class Service {
          start() {}
        }
        const service = new Service();
        function wrapper() {
          const service = getOther();
          service.start();
        }
        service.start();
      `;
      const { analysis, symbolTable } = await analyze(source);
      const startSymbol = symbolTable.symbols.find((s) => s.kind === "method" && s.name === "start" && s.containerName === "Service");
      const innerCall = analysis.calls.find((c) => c.callerName === "wrapper" && c.calleeName === "service.start");
      const outerCall = analysis.calls.find((c) => c.callerName === "module" && c.calleeName === "service.start");

      expect(startSymbol).toBeDefined();
      expect(outerCall?.resolutionState).toBe("RESOLVED");
      expect(outerCall?.targetSymbolId).toBe(startSymbol?.id);
      expect(innerCall?.resolutionState).toBe("UNRESOLVED");
      expect(innerCall?.targetSymbolId).toBeUndefined();
    });

    it("Case G3: prevents outer class instance receiver from leaking into function parameter scope", async () => {
      const source = `
        class Service {
          start() {}
        }
        const service = new Service();
        function wrapper(service) {
          service.start();
        }
      `;
      const { analysis } = await analyze(source);
      const paramCall = analysis.calls.find((c) => c.callerName === "wrapper" && c.calleeName === "service.start");

      expect(paramCall?.resolutionState).toBe("UNRESOLVED");
      expect(paramCall?.targetSymbolId).toBeUndefined();
    });

    it("Case G4: prevents outer class instance receiver from leaking into catch parameter scope", async () => {
      const source = `
        class Service {
          start() {}
        }
        const service = new Service();
        function wrapper() {
          try {} catch (service) {
            service.start();
          }
        }
      `;
      const { analysis } = await analyze(source);
      const catchCall = analysis.calls.find((c) => c.callerName === "wrapper" && c.calleeName === "service.start");

      expect(catchCall?.resolutionState).toBe("UNRESOLVED");
      expect(catchCall?.targetSymbolId).toBeUndefined();
    });

    it("Case G5: isolates this context in nested regular functions while preserving arrow function lexical this", async () => {
      const source = `
        class Controller {
          handle() {
            const arrow = () => {
              this.validate();
            };
            function regular() {
              this.validate();
            }
            this.validate();
          }
          validate() {}
        }
      `;
      const { analysis, symbolTable } = await analyze(source);
      const validateSymbol = symbolTable.symbols.find((s) => s.kind === "method" && s.name === "validate" && s.containerName === "Controller");
      const calls = analysis.calls.filter((c) => c.calleeName === "this.validate");

      expect(validateSymbol).toBeDefined();
      expect(calls.length).toBe(3);

      const arrowCall = calls.find((c) => c.callerName === "arrow" || (c.callerName === "handle" && c.location?.line === 5));
      const regularCall = calls.find((c) => c.callerName === "regular");
      const handleCall = calls.find((c) => c.callerName === "handle" && c.location?.line === 10);

      expect(arrowCall?.resolutionState).toBe("RESOLVED");
      expect(arrowCall?.targetSymbolId).toBe(validateSymbol?.id);
      expect(regularCall?.resolutionState).toBe("UNRESOLVED");
      expect(regularCall?.targetSymbolId).toBeUndefined();
      expect(handleCall?.resolutionState).toBe("RESOLVED");
      expect(handleCall?.targetSymbolId).toBe(validateSymbol?.id);
    });

    it("Case G6: distinguishes same-name methods across distinct class instances without cross-target collision", async () => {
      const source = `
        class ServiceA {
          execute() { return "A"; }
        }
        class ServiceB {
          execute() { return "B"; }
        }
        const a = new ServiceA();
        const b = new ServiceB();
        a.execute();
        b.execute();
      `;
      const { analysis, symbolTable } = await analyze(source);
      const methodA = symbolTable.symbols.find((s) => s.kind === "method" && s.name === "execute" && s.containerName === "ServiceA");
      const methodB = symbolTable.symbols.find((s) => s.kind === "method" && s.name === "execute" && s.containerName === "ServiceB");
      const callA = analysis.calls.find((c) => c.calleeName === "a.execute");
      const callB = analysis.calls.find((c) => c.calleeName === "b.execute");

      expect(methodA).toBeDefined();
      expect(methodB).toBeDefined();
      expect(callA?.resolutionState).toBe("RESOLVED");
      expect(callA?.targetSymbolId).toBe(methodA?.id);
      expect(callB?.resolutionState).toBe("RESOLVED");
      expect(callB?.targetSymbolId).toBe(methodB?.id);
      expect(callA?.targetSymbolId).not.toBe(callB?.targetSymbolId);
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

    it("Case J1: clears receiver provenance upon dynamic variable reassignment", async () => {
      const source = `
        class Service {
          start() {}
        }
        let service = new Service();
        service.start();
        service = getOther();
        service.start();
      `;
      const { analysis, symbolTable } = await analyze(source);
      const startSymbol = symbolTable.symbols.find((s) => s.kind === "method" && s.name === "start" && s.containerName === "Service");
      const calls = analysis.calls.filter((c) => c.calleeName === "service.start");

      expect(startSymbol).toBeDefined();
      expect(calls.length).toBe(2);
      expect(calls[0]?.resolutionState).toBe("RESOLVED");
      expect(calls[0]?.targetSymbolId).toBe(startSymbol?.id);
      expect(calls[1]?.resolutionState).toBe("UNRESOLVED");
      expect(calls[1]?.targetSymbolId).toBeUndefined();
    });

    it("Case J2: clears receiver provenance upon destructuring reassignment", async () => {
      const source = `
        class Service {
          start() {}
        }
        let service = new Service();
        service.start();
        ({ service } = getOther());
        service.start();
      `;
      const { analysis, symbolTable } = await analyze(source);
      const startSymbol = symbolTable.symbols.find((s) => s.kind === "method" && s.name === "start" && s.containerName === "Service");
      const calls = analysis.calls.filter((c) => c.calleeName === "service.start");

      expect(startSymbol).toBeDefined();
      expect(calls.length).toBe(2);
      expect(calls[0]?.resolutionState).toBe("RESOLVED");
      expect(calls[0]?.targetSymbolId).toBe(startSymbol?.id);
      expect(calls[1]?.resolutionState).toBe("UNRESOLVED");
      expect(calls[1]?.targetSymbolId).toBeUndefined();
    });

    it("Case K1: named function declaration shadows outer receiver in applicable scope", async () => {
      const source = `
        class Service {
          start() {}
        }
        const service = new Service();
        function wrapper() {
          function service() {}
          service.start();
        }
        service.start();
      `;
      const { analysis, symbolTable } = await analyze(source);
      const startSymbol = symbolTable.symbols.find((s) => s.kind === "method" && s.name === "start" && s.containerName === "Service");
      const wrapperCall = analysis.calls.find((c) => c.callerName === "wrapper" && c.calleeName === "service.start");
      const outerCall = analysis.calls.find((c) => c.callerName === "module" && c.calleeName === "service.start");

      expect(wrapperCall?.resolutionState).toBe("UNRESOLVED");
      expect(wrapperCall?.targetSymbolId).toBeUndefined();
      expect(outerCall?.resolutionState).toBe("RESOLVED");
      expect(outerCall?.targetSymbolId).toBe(startSymbol?.id);
    });

    it("Case K2: named class declaration shadows outer receiver in applicable scope", async () => {
      const source = `
        class Service {
          start() {}
        }
        const service = new Service();
        function wrapper() {
          class service {}
          service.start();
        }
        service.start();
      `;
      const { analysis, symbolTable } = await analyze(source);
      const startSymbol = symbolTable.symbols.find((s) => s.kind === "method" && s.name === "start" && s.containerName === "Service");
      const wrapperCall = analysis.calls.find((c) => c.callerName === "wrapper" && c.calleeName === "service.start");
      const outerCall = analysis.calls.find((c) => c.callerName === "module" && c.calleeName === "service.start");

      expect(wrapperCall?.resolutionState).toBe("UNRESOLVED");
      expect(wrapperCall?.targetSymbolId).toBeUndefined();
      expect(outerCall?.resolutionState).toBe("RESOLVED");
      expect(outerCall?.targetSymbolId).toBe(startSymbol?.id);
    });

    it("Case L: class private method parameter shadows outer receiver variable", async () => {
      const source = `
        class Service {
          start() {}
        }
        const service = new Service();
        class Worker {
          #run(service) {
            service.start();
          }
        }
      `;
      const { analysis } = await analyze(source);
      const privateCall = analysis.calls.find((c) => c.calleeName === "service.start");

      expect(privateCall).toBeDefined();
      expect(privateCall?.callerName).toBe("run");
      expect(privateCall?.resolutionState).toBe("UNRESOLVED");
      expect(privateCall?.targetSymbolId).toBeUndefined();
    });

    it("Case M: named function declaration shadows outer receiver before its textual declaration (hoisting)", async () => {
      const source = `
        class Service {
          start() {}
        }
        const service = new Service();
        function wrapper() {
          service.start();
          function service() {}
        }
      `;
      const { analysis } = await analyze(source);
      const wrapperCall = analysis.calls.find((c) => c.callerName === "wrapper" && c.calleeName === "service.start");

      expect(wrapperCall).toBeDefined();
      expect(wrapperCall?.resolutionState).toBe("UNRESOLVED");
      expect(wrapperCall?.targetSymbolId).toBeUndefined();
    });

    it("Case N: named class declaration shadows outer receiver before its textual declaration", async () => {
      const source = `
        class Service {
          start() {}
        }
        const service = new Service();
        function wrapper() {
          service.start();
          class service {}
        }
      `;
      const { analysis } = await analyze(source);
      const wrapperCall = analysis.calls.find((c) => c.callerName === "wrapper" && c.calleeName === "service.start");

      expect(wrapperCall).toBeDefined();
      expect(wrapperCall?.resolutionState).toBe("UNRESOLVED");
      expect(wrapperCall?.targetSymbolId).toBeUndefined();
    });

    it("Case O: named function declaration shadows outer receiver after its textual declaration", async () => {
      const source = `
        class Service {
          start() {}
        }
        const service = new Service();
        function wrapper() {
          function service() {}
          service.start();
        }
      `;
      const { analysis } = await analyze(source);
      const wrapperCall = analysis.calls.find((c) => c.callerName === "wrapper" && c.calleeName === "service.start");

      expect(wrapperCall).toBeDefined();
      expect(wrapperCall?.resolutionState).toBe("UNRESOLVED");
      expect(wrapperCall?.targetSymbolId).toBeUndefined();
    });

    it("Case P: nested block function declaration shadows receiver inside block while preserving outer resolution", async () => {
      const source = `
        class Service {
          start() {}
        }
        const service = new Service();
        function wrapper() {
          {
            service.start();
            function service() {}
          }
          service.start();
        }
      `;
      const { analysis, symbolTable } = await analyze(source);
      const startSymbol = symbolTable.symbols.find((s) => s.kind === "method" && s.name === "start" && s.containerName === "Service");
      const innerCall = analysis.calls.find((c) => c.callerName === "wrapper" && c.calleeName === "service.start" && c.location?.line === 8);
      const outerCall = analysis.calls.find((c) => c.callerName === "wrapper" && c.calleeName === "service.start" && c.location?.line === 11);

      expect(innerCall).toBeDefined();
      expect(innerCall?.resolutionState).toBe("UNRESOLVED");
      expect(innerCall?.targetSymbolId).toBeUndefined();

      expect(outerCall).toBeDefined();
      expect(outerCall?.resolutionState).toBe("RESOLVED");
      expect(outerCall?.targetSymbolId).toBe(startSymbol?.id);
    });

    it("Case Q: logical OR compound assignment (||=) does not infer definite receiver", async () => {
      const source = `
        class Service {
          start() {}
        }
        let service;
        service ||= new Service();
        service.start();
      `;
      const { analysis } = await analyze(source);
      const startCall = analysis.calls.find((c) => c.calleeName === "service.start");

      expect(startCall).toBeDefined();
      expect(startCall?.resolutionState).toBe("UNRESOLVED");
      expect(startCall?.targetSymbolId).toBeUndefined();
    });

    it("Case R: logical AND compound assignment (&&=) does not infer definite receiver", async () => {
      const source = `
        class Service {
          start() {}
        }
        let service;
        service &&= new Service();
        service.start();
      `;
      const { analysis } = await analyze(source);
      const startCall = analysis.calls.find((c) => c.calleeName === "service.start");

      expect(startCall).toBeDefined();
      expect(startCall?.resolutionState).toBe("UNRESOLVED");
      expect(startCall?.targetSymbolId).toBeUndefined();
    });

    it("Case S: nullish coalescing compound assignment (??=) does not infer definite receiver", async () => {
      const source = `
        class Service {
          start() {}
        }
        let service;
        service ??= new Service();
        service.start();
      `;
      const { analysis } = await analyze(source);
      const startCall = analysis.calls.find((c) => c.calleeName === "service.start");

      expect(startCall).toBeDefined();
      expect(startCall?.resolutionState).toBe("UNRESOLVED");
      expect(startCall?.targetSymbolId).toBeUndefined();
    });

    it("Case T: compound assignment invalidates previously definite receiver", async () => {
      const source = `
        class Service {
          start() {}
        }
        class OtherService {
          start() {}
        }
        let service = new Service();
        service ||= new OtherService();
        service.start();
      `;
      const { analysis } = await analyze(source);
      const startCall = analysis.calls.find((c) => c.calleeName === "service.start");

      expect(startCall).toBeDefined();
      expect(startCall?.resolutionState).toBe("UNRESOLVED");
      expect(startCall?.targetSymbolId).toBeUndefined();
    });

    it("Case U: definite assignment (=) resolves to assigned class instance", async () => {
      const source = `
        class Service {
          start() {}
        }
        let service;
        service = new Service();
        service.start();
      `;
      const { analysis, symbolTable } = await analyze(source);
      const startSymbol = symbolTable.symbols.find((s) => s.kind === "method" && s.name === "start" && s.containerName === "Service");
      const startCall = analysis.calls.find((c) => c.calleeName === "service.start");

      expect(startCall).toBeDefined();
      expect(startCall?.resolutionState).toBe("RESOLVED");
      expect(startCall?.targetSymbolId).toBe(startSymbol?.id);
    });

    it("Case V1: bare call parameter shadows outer function (anti-hallucination)", async () => {
      const source = `
        function handler() {}
        function execute(handler) {
          handler();
        }
      `;
      const { analysis } = await analyze(source);
      const executeCall = analysis.calls.find((c) => c.callerName === "execute" && c.calleeName === "handler");

      expect(executeCall).toBeDefined();
      expect(executeCall?.resolutionState).toBe("UNRESOLVED");
      expect(executeCall?.targetSymbolId).toBeUndefined();
    });

    it("Case V2: bare call local variable shadows outer function", async () => {
      const source = `
        function handler() {}
        function execute() {
          const handler = something;
          handler();
        }
      `;
      const { analysis } = await analyze(source);
      const executeCall = analysis.calls.find((c) => c.callerName === "execute" && c.calleeName === "handler");

      expect(executeCall).toBeDefined();
      expect(executeCall?.resolutionState).toBe("UNRESOLVED");
      expect(executeCall?.targetSymbolId).toBeUndefined();
    });

    it("Case V3: unshadowed bare call resolves to outer function correctly", async () => {
      const source = `
        function handler() {}
        function execute() {
          handler();
        }
      `;
      const { analysis, symbolTable } = await analyze(source);
      const handlerSymbol = symbolTable.symbols.find((s) => s.kind === "function" && s.name === "handler");
      const executeCall = analysis.calls.find((c) => c.callerName === "execute" && c.calleeName === "handler");

      expect(executeCall).toBeDefined();
      expect(executeCall?.resolutionState).toBe("RESOLVED");
      expect(executeCall?.targetSymbolId).toBe(handlerSymbol?.id);
    });

    it("Case V4: bare call local assigned function resolves to inner function", async () => {
      const source = `
        function handler() {}
        function execute() {
          const handler = () => {};
          handler();
        }
      `;
      const { analysis, symbolTable } = await analyze(source);
      const outerHandler = symbolTable.symbols.find((s) => s.kind === "function" && s.name === "handler" && s.scopeId === "scope:module");
      const executeCall = analysis.calls.find((c) => c.callerName === "execute" && c.calleeName === "handler");

      expect(executeCall).toBeDefined();
      expect(executeCall?.resolutionState).toBe("RESOLVED");
      expect(executeCall?.targetSymbolId).toBeDefined();
      expect(executeCall?.targetSymbolId).not.toBe(outerHandler?.id);
    });

    it("Case V5: catch clause parameter shadows outer function", async () => {
      const source = `
        function handler() {}
        try {
          doWork();
        } catch (handler) {
          handler();
        }
      `;
      const { analysis } = await analyze(source);
      const catchCall = analysis.calls.find((c) => c.calleeName === "handler");

      expect(catchCall).toBeDefined();
      expect(catchCall?.resolutionState).toBe("UNRESOLVED");
      expect(catchCall?.targetSymbolId).toBeUndefined();
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
