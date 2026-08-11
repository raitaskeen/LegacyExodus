import { describe, expect, test } from "bun:test";

import { DeterministicControlFlowGraphBuilder, DeterministicDataFlowGraphBuilder } from "@flow/index";
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
});
