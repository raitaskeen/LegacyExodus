import { describe, expect, it } from "bun:test";

import { DeterministicDependencyGraphBuilder } from "@graph/index";
import { JavaScriptParser } from "@parser/index";
import { DeterministicSemanticAnalysisEngine } from "@semantic/index";
import { JavaScriptSymbolExtractor } from "@symbols/index";

describe("F-001: Semantic Call Semantics — .bind() vs .call() / .apply()", () => {
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

  // ─── Case A: .bind() without invocation does NOT create a call edge ──────
  it("Case A: .bind() without invocation does not fabricate a call edge to the target function", async () => {
    const source = `
      function calculateTotal(subtotal, taxRate) {
        return subtotal + (subtotal * taxRate);
      }
      const withStandardTax = calculateTotal.bind(null, 100);
    `;
    const { analysis, symbolTable } = await analyze(source);
    const targetSymbol = symbolTable.symbols.find((s) => s.kind === "function" && s.name === "calculateTotal");
    expect(targetSymbol).toBeDefined();

    // Must NOT have any call resolving to calculateTotal
    const targetCalls = analysis.calls.filter((c) => c.targetSymbolId === targetSymbol?.id);
    expect(targetCalls).toHaveLength(0);

    // Must NOT have any resolved references to calculateTotal
    const resolvedRefs = analysis.references.filter((r) => r.resolvedSymbolId === targetSymbol?.id);
    expect(resolvedRefs).toHaveLength(0);
  });

  // ─── Case B: Immediate invocation of bound result ────────────────────────
  it("Case B: immediate invocation of bound result resolves to the target function", async () => {
    const source = `
      function compute(x) { return x * 2; }
      compute.bind(null, 21)();
    `;
    const { analysis, symbolTable } = await analyze(source);
    const targetSymbol = symbolTable.symbols.find((s) => s.kind === "function" && s.name === "compute");
    expect(targetSymbol).toBeDefined();

    // Resolves to target function compute
    const directTargetCalls = analysis.calls.filter((c) => c.targetSymbolId === targetSymbol?.id);
    expect(directTargetCalls).toHaveLength(1);
    expect(directTargetCalls[0]?.calleeName).toBe("compute");
    expect(directTargetCalls[0]?.resolutionState).toBe("RESOLVED");
  });

  // ─── Case C: .call() remains an active invocation ────────────────────────
  it("Case C: .call() invokes the target function immediately and emits a resolved call edge", async () => {
    const source = `
      function executeTask(context, taskId) {
        return taskId;
      }
      executeTask.call(null, "task-101");
    `;
    const { analysis, symbolTable } = await analyze(source);
    const targetSymbol = symbolTable.symbols.find((s) => s.kind === "function" && s.name === "executeTask");
    expect(targetSymbol).toBeDefined();

    const call = analysis.calls.find((c) => c.targetSymbolId === targetSymbol?.id);
    expect(call).toBeDefined();
    expect(call?.calleeName).toBe("executeTask");
    expect(call?.resolutionState).toBe("RESOLVED");
  });

  // ─── Case D: .apply() remains an active invocation ───────────────────────
  it("Case D: .apply() invokes the target function immediately and emits a resolved call edge", async () => {
    const source = `
      function processBatch(context, items) {
        return items.length;
      }
      processBatch.apply(null, [[1, 2, 3]]);
    `;
    const { analysis, symbolTable } = await analyze(source);
    const targetSymbol = symbolTable.symbols.find((s) => s.kind === "function" && s.name === "processBatch");
    expect(targetSymbol).toBeDefined();

    const call = analysis.calls.find((c) => c.targetSymbolId === targetSymbol?.id);
    expect(call).toBeDefined();
    expect(call?.calleeName).toBe("processBatch");
    expect(call?.resolutionState).toBe("RESOLVED");
  });

  // ─── Case E: Method binding vs method call / apply ────────────────────────
  it("Case E: distinguishes receiver method .bind() from method .call() / .apply()", async () => {
    const source = `
      const service = {};
      service.dispatch = function(event) { return event; };

      const boundDispatch = service.dispatch.bind(service);
      service.dispatch.call(service, "event-A");
      service.dispatch.apply(service, ["event-B"]);
    `;
    const { analysis, symbolTable } = await analyze(source);
    const dispatchSymbol = symbolTable.symbols.find((s) => s.kind === "method" && s.name === "dispatch" && s.containerName === "service");
    expect(dispatchSymbol).toBeDefined();

    const resolvedCalls = analysis.calls.filter((c) => c.targetSymbolId === dispatchSymbol?.id);
    // .call and .apply generate resolved call edges (2 calls), but .bind does not
    expect(resolvedCalls).toHaveLength(2);
    expect(resolvedCalls.every((c) => c.calleeName === "service.dispatch" && c.resolutionState === "RESOLVED")).toBe(true);
  });

  // ─── Case F: Determinism across repeated runs ─────────────────────────────
  it("Case F: produces bit-for-bit deterministic call graphs across repeated analyses", async () => {
    const source = `
      function a(x) { return x; }
      function b(y) { return y; }
      const boundA = a.bind(null, 1);
      b.call(null, 2);
      a.apply(null, [3]);
    `;
    const run1 = await analyze(source);
    const run2 = await analyze(source);

    expect(run1.analysis.calls).toEqual(run2.analysis.calls);
    expect(run1.analysis.references).toEqual(run2.analysis.references);
  });
});
