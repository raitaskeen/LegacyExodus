import { describe, expect, test } from "bun:test";

import { DeterministicDataFlowGraphBuilder, type DataFlowGraph, type VariableDefinition } from "@flow/index";
import { JavaScriptParser } from "@parser/index";

describe("foreach data-flow precision", () => {
  test("propagates a for-of iterable value through its declaration binding to a sink", async (): Promise<void> => {
    const graph = await buildDataFlowGraph(
      "for-of-declaration",
      "const items = req.body.items; for (const item of items) { child_process.exec(item); }",
    );
    const items = definition(graph, "items", "declaration");
    const item = definition(graph, "item", "declaration");
    const flow = graph.taintFlows.find((candidate) => candidate.path.at(-1) === "child_process.exec");

    expect(flow?.path.slice(1)).toEqual([items.id, item.id, "child_process.exec"]);
    expect(graph.uses.some((use) => use.name === "item" && use.definitionId === item.id)).toBe(true);
  });

  test("models a predeclared for-of binding as an iteration assignment", async (): Promise<void> => {
    const graph = await buildDataFlowGraph(
      "for-of-assignment",
      "const items = req.body.items; let item; for (item of items) { child_process.exec(item); }",
    );
    const items = definition(graph, "items", "declaration");
    const item = definition(graph, "item", "assignment");
    const flow = graph.taintFlows.find((candidate) => candidate.path.at(-1) === "child_process.exec");

    expect(flow?.path.slice(1)).toEqual([items.id, item.id, "child_process.exec"]);
    expect(graph.uses.some((use) => use.name === "item" && use.definitionId === item.id)).toBe(true);
  });

  test("does not invent taint for a for-of binding over a clean iterable", async (): Promise<void> => {
    const graph = await buildDataFlowGraph(
      "for-of-clean",
      "const items = safeItems; for (const item of items) { child_process.exec(item); }",
    );
    const item = definition(graph, "item", "declaration");

    expect(graph.taintFlows).toEqual([]);
    expect(graph.uses.some((use) => use.name === "item" && use.definitionId === item.id)).toBe(true);
  });

  test("keeps for-in property-key taint unresolved while preserving its lexical binding", async (): Promise<void> => {
    const graph = await buildDataFlowGraph(
      "for-in-key",
      "const payload = req.body.data; for (const key in payload) { child_process.exec(key); }",
    );
    const key = definition(graph, "key", "declaration");

    expect(graph.taintFlows).toEqual([]);
    expect(graph.uses.some((use) => use.name === "key" && use.definitionId === key.id)).toBe(true);
  });

  test("produces deterministic for-of data-flow output", async (): Promise<void> => {
    const source = "const items = req.body.items; for (const item of items) { child_process.exec(item); }";

    expect(JSON.stringify(await buildDataFlowGraph("for-of-repeat", source))).toBe(
      JSON.stringify(await buildDataFlowGraph("for-of-repeat", source)),
    );
  });
});

async function buildDataFlowGraph(id: string, source: string): Promise<DataFlowGraph> {
  const ast = (
    await new JavaScriptParser().parse({
      file: { id, path: `src/${id}.js`, language: "javascript", size: source.length },
      source,
    })
  ).result;
  return new DeterministicDataFlowGraphBuilder().build(ast);
}

function definition(
  graph: DataFlowGraph,
  name: string,
  kind: VariableDefinition["kind"],
): VariableDefinition {
  const result = graph.definitions.find((candidate) => candidate.name === name && candidate.kind === kind);
  if (result === undefined) throw new Error(`Expected ${kind} definition for ${name}.`);
  return result;
}
