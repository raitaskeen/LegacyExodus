import { describe, expect, it } from "bun:test";

import { DeterministicDependencyGraphBuilder } from "@graph/index";
import { JavaScriptParser } from "@parser/index";
import { DeterministicSemanticAnalysisEngine } from "@semantic/index";
import { JavaScriptSymbolExtractor } from "@symbols/index";

describe("F-05: Call Graph Resolution — .bind() Receiver & Bound-Function Invocations", () => {
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

  // ─── Test 1: Direct function immediate invocation ────────────────────────
  it("Test 1: resolves immediately invoked bound function to target symbol", async () => {
    const source = `
      function compute(x, y) { return x + y; }
      compute.bind(null, 10)(20);
    `;
    const { analysis, symbolTable } = await analyze(source);
    const targetSymbol = symbolTable.symbols.find((s) => s.kind === "function" && s.name === "compute");
    expect(targetSymbol).toBeDefined();

    const targetCalls = analysis.calls.filter((c) => c.targetSymbolId === targetSymbol?.id);
    expect(targetCalls).toHaveLength(1);
    expect(targetCalls[0]?.calleeName).toBe("compute");
    expect(targetCalls[0]?.resolutionState).toBe("RESOLVED");
    expect(targetCalls[0]?.callerName).toBe("module");

    // Must NOT emit duplicate compute.bind edge
    const bindCalls = analysis.calls.filter((c) => c.calleeName === "compute.bind");
    expect(bindCalls).toHaveLength(0);
  });

  // ─── Test 2: Object method immediate invocation ──────────────────────────
  it("Test 2: resolves immediately invoked bound object method to target method symbol", async () => {
    const source = `
      const service = {};
      service.calculate = function(a, b) { return a * b; };
      service.calculate.bind(service, 5)(10);
    `;
    const { analysis, symbolTable } = await analyze(source);
    const methodSymbol = symbolTable.symbols.find((s) => s.kind === "method" && s.name === "calculate");
    expect(methodSymbol).toBeDefined();

    const methodCalls = analysis.calls.filter((c) => c.targetSymbolId === methodSymbol?.id);
    expect(methodCalls).toHaveLength(1);
    expect(methodCalls[0]?.calleeName).toBe("service.calculate");
    expect(methodCalls[0]?.resolutionState).toBe("RESOLVED");

    // Must NOT emit duplicate service.calculate.bind edge
    const bindCalls = analysis.calls.filter((c) => c.calleeName.endsWith(".bind"));
    expect(bindCalls).toHaveLength(0);
  });

  // ─── Test 3: Class this.method bound invocation ──────────────────────────
  it("Test 3: resolves this.method.bind() invocation within class context", async () => {
    const source = `
      class Worker {
        process(data) { return data; }
        run() {
          this.process.bind(this, "payload")();
        }
      }
    `;
    const { analysis, symbolTable } = await analyze(source);
    const methodSymbol = symbolTable.symbols.find((s) => s.kind === "method" && s.name === "process");
    expect(methodSymbol).toBeDefined();

    const methodCalls = analysis.calls.filter((c) => c.targetSymbolId === methodSymbol?.id);
    expect(methodCalls).toHaveLength(1);
    expect(methodCalls[0]?.calleeName).toBe("this.process");
    expect(methodCalls[0]?.callerName).toBe("run");
    expect(methodCalls[0]?.resolutionState).toBe("RESOLVED");

    // Must NOT emit duplicate this.process.bind edge
    const bindCalls = analysis.calls.filter((c) => c.calleeName.endsWith(".bind"));
    expect(bindCalls).toHaveLength(0);
  });

  // ─── Test 4: Class this.#privateMethod bound invocation ──────────────────
  it("Test 4: resolves this.#privateMethod.bind() invocation to private method symbol", async () => {
    const source = `
      class SecureVault {
        #unlock(key) { return key === "secret"; }
        open() {
          this.#unlock.bind(this, "secret")();
        }
      }
    `;
    const { analysis, symbolTable } = await analyze(source);
    const privateMethodSymbol = symbolTable.symbols.find((s) => s.kind === "method" && s.name === "#unlock");
    expect(privateMethodSymbol).toBeDefined();

    const calls = analysis.calls.filter((c) => c.targetSymbolId === privateMethodSymbol?.id);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.calleeName).toBe("this.#unlock");
    expect(calls[0]?.callerName).toBe("open");
    expect(calls[0]?.resolutionState).toBe("RESOLVED");

    // Must NOT emit duplicate this.#unlock.bind edge
    const bindCalls = analysis.calls.filter((c) => c.calleeName.endsWith(".bind"));
    expect(bindCalls).toHaveLength(0);
  });

  // ─── Test 5: Chained .bind() invocations ─────────────────────────────────
  it("Test 5: unwraps chained .bind().bind() invocations to target function", async () => {
    const source = `
      function transform(a, b, c) { return a + b + c; }
      transform.bind(null, 1).bind(null, 2)(3);
    `;
    const { analysis, symbolTable } = await analyze(source);
    const targetSymbol = symbolTable.symbols.find((s) => s.kind === "function" && s.name === "transform");
    expect(targetSymbol).toBeDefined();

    const targetCalls = analysis.calls.filter((c) => c.targetSymbolId === targetSymbol?.id);
    expect(targetCalls).toHaveLength(1);
    expect(targetCalls[0]?.calleeName).toBe("transform");
    expect(targetCalls[0]?.resolutionState).toBe("RESOLVED");

    // No intermediate .bind calls emitted
    const bindCalls = analysis.calls.filter((c) => c.calleeName.includes(".bind"));
    expect(bindCalls).toHaveLength(0);
  });

  // ─── Test 6: Non-invoked .bind does NOT fabricate target call edge ────────
  it("Test 6: non-invoked .bind() does NOT fabricate an invocation call edge to target", async () => {
    const source = `
      function processItem(item) { return item; }
      const boundItemProcessor = processItem.bind(null, 42);
    `;
    const { analysis, symbolTable } = await analyze(source);
    const targetSymbol = symbolTable.symbols.find((s) => s.kind === "function" && s.name === "processItem");
    expect(targetSymbol).toBeDefined();

    // Must NOT have any call resolving to processItem
    const targetCalls = analysis.calls.filter((c) => c.targetSymbolId === targetSymbol?.id);
    expect(targetCalls).toHaveLength(0);
  });

  // ─── Test 7: Adversarial - Dynamic computed property binding ─────────────
  it("Test 7: does not hallucinate target for dynamic computed member binding", async () => {
    const source = `
      function secret() { return 1; }
      const obj = { secret };
      const dyn = "secret";
      obj[dyn].bind(obj)();
    `;
    const { analysis, symbolTable } = await analyze(source);
    const secretSymbol = symbolTable.symbols.find((s) => s.kind === "function" && s.name === "secret");
    expect(secretSymbol).toBeDefined();

    // Must NOT resolve to secret because obj[dyn] is computed dynamic
    const calls = analysis.calls.filter((c) => c.targetSymbolId === secretSymbol?.id);
    expect(calls).toHaveLength(0);
  });

  // ─── Test 8: Adversarial - Unknown receiver binding ──────────────────────
  it("Test 8: records unresolved call for unknown unbound receiver invocation", async () => {
    const source = `
      unknownService.action.bind(null, 1)();
    `;
    const { analysis } = await analyze(source);
    const call = analysis.calls.find((c) => c.calleeName === "unknownService.action");
    expect(call).toBeDefined();
    expect(call?.resolutionState).toBe("UNRESOLVED");
    expect(call?.targetSymbolId).toBeUndefined();

    // Must NOT emit duplicate unknownService.action.bind
    const bindCalls = analysis.calls.filter((c) => c.calleeName.endsWith(".bind"));
    expect(bindCalls).toHaveLength(0);
  });

  // ─── Test 9: Bound function invoked via .call() or .apply() ──────────────
  it("Test 9: resolves bound function invoked via .call() or .apply()", async () => {
    const source = `
      function handler(code) { return code; }
      handler.bind(null).call(null, 200);
      handler.bind(null).apply(null, [400]);
    `;
    const { analysis, symbolTable } = await analyze(source);
    const targetSymbol = symbolTable.symbols.find((s) => s.kind === "function" && s.name === "handler");
    expect(targetSymbol).toBeDefined();

    const targetCalls = analysis.calls.filter((c) => c.targetSymbolId === targetSymbol?.id);
    expect(targetCalls).toHaveLength(2);
    expect(targetCalls.every((c) => c.calleeName === "handler" && c.resolutionState === "RESOLVED")).toBe(true);

    const bindCalls = analysis.calls.filter((c) => c.calleeName.includes(".bind"));
    expect(bindCalls).toHaveLength(0);
  });

  // ─── Test 10: Determinism across repeated runs ───────────────────────────
  it("Test 10: bit-for-bit deterministic call graphs across repeated runs", async () => {
    const source = `
      class Engine {
        execute(op) { return op; }
        run() {
          const fn = this.execute.bind(this);
          this.execute.bind(this, "step-1")();
          this.execute.bind(this).call(this, "step-2");
        }
      }
    `;
    const run1 = await analyze(source);
    const run2 = await analyze(source);

    expect(run1.analysis.calls).toEqual(run2.analysis.calls);
    expect(run1.analysis.references).toEqual(run2.analysis.references);
  });
});
