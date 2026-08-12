import { describe, expect, test } from "bun:test";

import { DeterministicControlFlowGraphBuilder, DeterministicDataFlowGraphBuilder, DeterministicFlowAnalysisEngine } from "@flow/index";
import { JavaScriptParser } from "@parser/index";

describe("control and data flow analysis", () => {
  test("builds deterministic branch, loop, dominator, reachability, and dead-code information", async (): Promise<void> => {
    const source = `
      let total = 0;
      if (true) { total = 1; } else { total = 2; }
      while (total < 3) { total = total + 1; continue; }
      return total;
      console.log("unreachable");
    `;
    const ast = (await new JavaScriptParser().parse({ file: { id: "flow", path: "src/flow.js", language: "javascript", size: source.length }, source })).result;
    const graph = new DeterministicControlFlowGraphBuilder().build(ast);

    expect(graph.edges.some((edge) => edge.kind === "true")).toBe(true);
    expect(graph.edges.some((edge) => edge.kind === "false")).toBe(true);
    expect(graph.edges.some((edge) => edge.kind === "loop-back")).toBe(true);
    expect(graph.dominators).toHaveLength(graph.blocks.length);
    expect(graph.unreachableBlockIds.length).toBeGreaterThan(0);
    expect(graph.deadCodeNodeIds.length).toBeGreaterThan(0);
    expect(Object.isFrozen(graph)).toBe(true);
  });

  test("builds deterministic definitions, uses, chains, lifetimes, and conservative constants", async (): Promise<void> => {
    const source = "const PORT = 3000; const id = PORT; console.log(id);";
    const ast = (await new JavaScriptParser().parse({ file: { id: "data", path: "src/data.js", language: "javascript", size: source.length }, source })).result;
    const graph = new DeterministicDataFlowGraphBuilder().build(ast);
    const port = graph.definitions.find((definition) => definition.name === "PORT");
    const id = graph.definitions.find((definition) => definition.name === "id");

    expect(port?.constantValue).toBe(3000);
    expect(graph.uses.some((use) => use.name === "PORT" && use.definitionId === port?.id)).toBe(true);
    expect(graph.uses.some((use) => use.name === "id" && use.definitionId === id?.id)).toBe(true);
    expect(graph.defUseChains.find((chain) => chain.definitionId === id?.id)?.useIds.length).toBeGreaterThan(0);
    expect(graph.lifetimes.find((lifetime) => lifetime.name === "id")?.declarationId).toBe(id?.id);
    expect(graph.taintFlows).toEqual([]);
    expect(Object.isFrozen(graph)).toBe(true);
  });

  test("creates independent module, function, arrow-function, and method CFGs", async (): Promise<void> => {
    const source = `
      function calculate(value) { if (value) return value; return 0; }
      const normalize = (input) => { return input; };
      class Catalog { load(id) { while (id) { break; } return id; } }
    `;
    const ast = (await new JavaScriptParser().parse({ file: { id: "scopes", path: "src/scopes.js", language: "javascript", size: source.length }, source })).result;
    const result = new DeterministicFlowAnalysisEngine().analyze([ast]);

    expect(result.controlFlowGraphs.map((graph) => graph.scopeName)).toEqual(expect.arrayContaining(["module", expect.stringMatching(/^calculate@/), expect.stringMatching(/^anonymous@/), expect.stringMatching(/^load@/)]));
    expect(result.controlFlowGraphs.filter((graph) => graph.scopeName !== "module").every((graph) => graph.blocks.length >= 2)).toBe(true);
    expect(result.controlFlowGraphs.map((graph) => graph.id)).toEqual([...result.controlFlowGraphs].map((graph) => graph.id).sort());
  });

  test("marks compile-time false branches and loops as unreachable", async (): Promise<void> => {
    const source = "if (false) { console.log('never'); } while (false) { console.log('also-never'); }";
    const ast = (await new JavaScriptParser().parse({ file: { id: "constants", path: "src/constants.js", language: "javascript", size: source.length }, source })).result;
    const graph = new DeterministicControlFlowGraphBuilder().build(ast);

    expect(graph.unreachableBlockIds.length).toBeGreaterThan(0);
    expect(graph.deadCodeNodeIds.length).toBeGreaterThan(0);
    expect(graph.edges.filter((edge) => edge.kind === "true")).toHaveLength(0);
  });
});
