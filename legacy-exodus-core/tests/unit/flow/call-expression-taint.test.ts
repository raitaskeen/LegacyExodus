import { describe, expect, test } from "bun:test";
import { DeterministicDataFlowGraphBuilder, DeterministicFlowAnalysisEngine } from "@flow/index";
import { DeterministicDependencyGraphBuilder } from "@graph/index";
import { JavaScriptParser } from "@parser/index";
import { DeterministicSemanticAnalysisEngine } from "@semantic/index";
import { JavaScriptSymbolExtractor } from "@symbols/index";

async function buildDataFlowGraph(id: string, source: string) {
  const ast = (await new JavaScriptParser().parse({ file: { id, path: `src/${id}.js`, language: "javascript", size: source.length }, source })).result;
  return new DeterministicDataFlowGraphBuilder().build(ast);
}

async function buildResolvedDataFlow(id: string, source: string) {
  const file = { id, path: `src/${id}.js`, language: "javascript", size: source.length } as const;
  const ast = (await new JavaScriptParser().parse({ file, source })).result;
  const symbols = new JavaScriptSymbolExtractor().extract(ast);
  const dependencyGraph = new DeterministicDependencyGraphBuilder().build([symbols], [file]);
  const semantic = new DeterministicSemanticAnalysisEngine().analyze({ astResults: [ast], dependencyGraph, symbolTables: [symbols] });
  const graph = new DeterministicFlowAnalysisEngine().analyze([ast], semantic.calls, [symbols]).dataFlowGraphs[0];
  if (graph === undefined) throw new Error("Expected a data-flow graph.");
  return { graph, semantic };
}

describe("F-02: Taint preservation through CallExpression", () => {
  test("1. direct tainted call result propagates to sink", async (): Promise<void> => {
    const source = `
      const x = req.body.trim();
      child_process.exec(x);
    `;
    const graph = await buildDataFlowGraph("direct-source-call", source);
    expect(graph.taintFlows).toHaveLength(1);
    expect(graph.taintFlows[0]?.path.at(-1)).toBe("child_process.exec");
    expect(graph.taintFlows[0]?.state).toBe("CONFIRMED");
  });

  test("2. tainted argument propagates across unresolved call to assigned variable and sink", async (): Promise<void> => {
    const source = `
      const input = req.body.name;
      const x = unknownTransform(input);
      child_process.exec(x);
    `;
    const graph = await buildDataFlowGraph("unresolved-call-arg", source);
    expect(graph.taintFlows).toHaveLength(1);
    expect(graph.taintFlows[0]?.path.at(-1)).toBe("child_process.exec");
  });

  test("3. method call with tainted argument propagates to sink", async (): Promise<void> => {
    const source = `
      const input = req.body.name;
      const x = obj.process(input);
      child_process.exec(x);
    `;
    const graph = await buildDataFlowGraph("method-call-arg", source);
    expect(graph.taintFlows).toHaveLength(1);
    expect(graph.taintFlows[0]?.path.at(-1)).toBe("child_process.exec");
  });

  test("4. method call on tainted receiver propagates to sink", async (): Promise<void> => {
    const source = `
      const input = req.body.name;
      const x = input.trim();
      child_process.exec(x);
    `;
    const graph = await buildDataFlowGraph("method-call-receiver", source);
    expect(graph.taintFlows).toHaveLength(1);
    expect(graph.taintFlows[0]?.path.at(-1)).toBe("child_process.exec");
  });

  test("5. dynamic/computed call with tainted argument propagates to sink", async (): Promise<void> => {
    const source = `
      const input = req.body.name;
      const x = object[methodName](input);
      child_process.exec(x);
    `;
    const graph = await buildDataFlowGraph("dynamic-call-arg", source);
    expect(graph.taintFlows).toHaveLength(1);
    expect(graph.taintFlows[0]?.path.at(-1)).toBe("child_process.exec");
  });

  // XA-01: a recognized sanitizer escapes HTML, so it protects the response body and not a command.
  test("6. recognized sanitizers protect the response body only: sanitize() and validator.escape()", async (): Promise<void> => {
    for (const sanitizer of ["sanitize", "validator.escape"]) {
      const atResponse = await buildDataFlowGraph(`sanitizer-response-${sanitizer}`, `
        const input = req.body.name;
        const clean = ${sanitizer}(input);
        res.send(clean);
      `);
      expect(atResponse.taintFlows).toEqual([]);

      const atCommand = await buildDataFlowGraph(`sanitizer-command-${sanitizer}`, `
        const input = req.body.name;
        const clean = ${sanitizer}(input);
        child_process.exec(clean);
      `);
      expect(atCommand.taintFlows).toHaveLength(1);
      expect(atCommand.taintFlows[0]?.path.at(-1)).toBe("child_process.exec");
    }
  });

  test("7. multi-argument call propagates taint if any argument is tainted", async (): Promise<void> => {
    const source1 = `
      const tainted = req.body.name;
      const safe = "safe";
      const x = process(tainted, safe);
      child_process.exec(x);
    `;
    const graph1 = await buildDataFlowGraph("multi-arg-first-tainted", source1);
    expect(graph1.taintFlows).toHaveLength(1);

    const source2 = `
      const tainted = req.body.name;
      const safe = "safe";
      const x = process(safe, tainted);
      child_process.exec(x);
    `;
    const graph2 = await buildDataFlowGraph("multi-arg-second-tainted", source2);
    expect(graph2.taintFlows).toHaveLength(1);

    const sourceSafe = `
      const safe1 = "safe1";
      const safe2 = "safe2";
      const x = process(safe1, safe2);
      child_process.exec(x);
    `;
    const graphSafe = await buildDataFlowGraph("multi-arg-all-safe", sourceSafe);
    expect(graphSafe.taintFlows).toEqual([]);
  });

  test("8. existing non-call taint behavior remains intact", async (): Promise<void> => {
    const source = `
      const a = req.body.name;
      const b = a;
      const c = b;
      child_process.exec(c);
    `;
    const graph = await buildDataFlowGraph("non-call-taint", source);
    expect(graph.taintFlows).toHaveLength(1);
    expect(graph.taintFlows[0]?.path.at(-1)).toBe("child_process.exec");
  });

  test("9. resolved function calls preserve interprocedural flow path without bypassing function body", async (): Promise<void> => {
    const source = `
      function normalize(value) { return value.trim(); }
      const name = req.body.name;
      const result = normalize(name);
      child_process.exec(result);
    `;
    const direct = await buildDataFlowGraph("resolved-interprocedural", source);
    expect(direct.taintFlows).toHaveLength(1);
    const flow = direct.taintFlows[0]!;
    expect(flow.path.at(-1)).toBe("child_process.exec");
    const valDef = direct.definitions.find((d) => d.name === "value" && d.kind === "parameter");
    const retDef = direct.definitions.find((d) => d.name === "normalize:return" && d.kind === "return");
    expect(valDef).toBeDefined();
    expect(retDef).toBeDefined();
    // Verify interprocedural parameter and return nodes are included in the path
    expect(flow.path).toContain(valDef!.id);
    expect(flow.path).toContain(retDef!.id);
  });

  test("10. unassigned function call does not taint unrelated safe variables", async (): Promise<void> => {
    const source = `
      const x = req.body.name;
      process(x);
      const safe = "clean";
      child_process.exec(safe);
    `;
    const graph = await buildDataFlowGraph("unassigned-call-safe", source);
    expect(graph.taintFlows).toEqual([]);
  });

  test("11. unassigned method call does not taint unrelated safe variables", async (): Promise<void> => {
    const source = `
      const x = req.body.name;
      obj.process(x);
      const safe = "clean";
      child_process.exec(safe);
    `;
    const graph = await buildDataFlowGraph("unassigned-method-call-safe", source);
    expect(graph.taintFlows).toEqual([]);
  });

  test("12. higher-order/dynamic function invocation propagates taint to return value", async (): Promise<void> => {
    const source = `
      const x = req.body.name;
      const fn = getFunction();
      const z = fn(x);
      child_process.exec(z);
    `;
    const graph = await buildDataFlowGraph("dynamic-fn-call", source);
    expect(graph.taintFlows).toHaveLength(1);
    expect(graph.taintFlows[0]?.path.at(-1)).toBe("child_process.exec");
  });

  test("13. nested call with direct source propagates taint to assigned variable", async (): Promise<void> => {
    const source = `
      const x = wrapper(process(req.body.name));
      child_process.exec(x);
    `;
    const graph = await buildDataFlowGraph("nested-direct-source", source);
    expect(graph.taintFlows).toHaveLength(1);
    expect(graph.taintFlows[0]?.path.at(-1)).toBe("child_process.exec");
  });

  test("14. nested call with tainted variable propagates taint through wrapper", async (): Promise<void> => {
    const source = `
      const input = req.body.name;
      const x = wrapper(process(input));
      child_process.exec(x);
    `;
    const graph = await buildDataFlowGraph("nested-var-source", source);
    expect(graph.taintFlows).toHaveLength(1);
    expect(graph.taintFlows[0]?.path.at(-1)).toBe("child_process.exec");
  });

  test("15. direct nested call expression in sink detects taint flow", async (): Promise<void> => {
    const source = `
      const input = req.body.name;
      child_process.exec(process(input));
    `;
    const graph = await buildDataFlowGraph("sink-nested-call", source);
    expect(graph.taintFlows).toHaveLength(1);
    expect(graph.taintFlows[0]?.path.at(-1)).toBe("child_process.exec");
  });

  test("16. safe expressions and calls do not become tainted merely by participating in calls", async (): Promise<void> => {
    const source = `
      const safe1 = "hello";
      const safe2 = "world";
      const result = safeFunc(safe1, safe2);
      child_process.exec(result);
    `;
    const graph = await buildDataFlowGraph("safe-calls-untainted", source);
    expect(graph.taintFlows).toEqual([]);
  });

  test("17. semantic engine data flow propagates taint through resolved semantic call", async (): Promise<void> => {
    const source = `
      function transform(val) { return val; }
      const input = req.body.name;
      const res = transform(input);
      child_process.exec(res);
    `;
    const { graph } = await buildResolvedDataFlow("semantic-resolved-call", source);
    expect(graph.taintFlows).toHaveLength(1);
    expect(graph.taintFlows[0]?.path.at(-1)).toBe("child_process.exec");
  });
});
