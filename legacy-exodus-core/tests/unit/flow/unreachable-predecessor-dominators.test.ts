import { describe, expect, test } from "bun:test";
import { DeterministicControlFlowGraphBuilder } from "@flow/control-flow-builder";
import type { BasicBlock, ControlFlowGraph } from "@flow/flow-contracts";
import { JavaScriptParser } from "@parser/index";

// The unreachable block left after break/continue/return still has an outgoing edge. It must not
// constrain the dominators of the reachable block it points at: every reachable block is dominated by
// the entry, and its immediate dominator is the one of the reachable subgraph.

async function graphOf(source: string): Promise<ControlFlowGraph> {
  const ast = (await new JavaScriptParser().parse({
    file: { id: "dominators", path: "src/dominators.js", language: "javascript", size: source.length }, source,
  })).result;
  expect(ast.errors).toEqual([]);
  const graph = new DeterministicControlFlowGraphBuilder().buildAll(ast).find((item) => item.scopeName.startsWith("f@"));
  if (graph === undefined) throw new Error("Missing f CFG");
  return graph;
}

function lines(...source: readonly string[]): string {
  return source.join("\n");
}

function at(graph: ControlFlowGraph, type: string, line: number): BasicBlock {
  const matches = graph.blocks.filter((block) => block.statements.some((node) => node.type === type && node.location?.line === line));
  expect(matches).toHaveLength(1);
  const block = matches[0];
  if (block === undefined) throw new Error(`Missing ${type} at ${line}`);
  return block;
}

function reachable(graph: ControlFlowGraph): Set<string> {
  const seen = new Set<string>();
  const pending = [graph.entryBlockId];
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    for (const edge of graph.edges) if (edge.fromBlockId === id) pending.push(edge.toBlockId);
  }
  return seen;
}

function immediateDominator(graph: ControlFlowGraph, blockId: string): string | undefined {
  return graph.dominators.find((candidate) => candidate.blockId === blockId)?.immediateDominatorId;
}

/** Textbook iterative dominators over the reachable subgraph, as an independent oracle. */
function expectedImmediateDominators(graph: ControlFlowGraph): Map<string, string | undefined> {
  const live = reachable(graph);
  const nodes = graph.blocks.map((block) => block.id).filter((id) => live.has(id));
  const dominators = new Map(nodes.map((id) => [id, new Set(id === graph.entryBlockId ? [id] : nodes)]));
  for (let changed = true; changed;) {
    changed = false;
    for (const id of nodes) {
      if (id === graph.entryBlockId) continue;
      const predecessors = graph.edges.filter((edge) => edge.toBlockId === id && live.has(edge.fromBlockId)).map((edge) => edge.fromBlockId);
      const next = new Set([id, ...nodes.filter((candidate) => predecessors.every((predecessor) => dominators.get(predecessor)?.has(candidate)))]);
      if (next.size !== dominators.get(id)?.size) { dominators.set(id, next); changed = true; }
    }
  }
  return new Map(nodes.filter((id) => id !== graph.entryBlockId).map((id) => {
    const strict = [...(dominators.get(id) ?? [])].filter((candidate) => candidate !== id);
    return [id, strict.find((candidate) => strict.every((other) => dominators.get(candidate)?.has(other)))];
  }));
}

function expectReachableDominatorTree(graph: ControlFlowGraph): void {
  for (const [blockId, expected] of expectedImmediateDominators(graph)) {
    expect({ blockId, immediateDominatorId: immediateDominator(graph, blockId) }).toEqual({ blockId, immediateDominatorId: expected });
    const chain = new Set<string>();
    for (let current: string | undefined = blockId; current !== undefined && !chain.has(current); current = immediateDominator(graph, current)) chain.add(current);
    expect(chain.has(graph.entryBlockId)).toBe(true);
  }
}

const ABRUPT_LOOP_TAIL = lines(
  "function f(c) {",
  "before();",
  "while (c) {",
  "work();",
  "return;",
  "}",
  "after();",
  "}",
);

const SWITCH_CASE_TAILS = lines(
  "function f(x) {",
  "switch (x) {",
  "case 1:",
  "a();",
  "break;",
  "default:",
  "b();",
  "break;",
  "}",
  "after();",
  "}",
);

const LABELLED_CONTINUE = lines(
  "function f() {",
  "outer: while (p) {",
  "while (q) {",
  "break outer;",
  "}",
  "continue outer;",
  "}",
  "}",
);

const NESTED_BREAK = lines(
  "function f(a, b) {",
  "while (a) {",
  "while (b) {",
  "step();",
  "break;",
  "}",
  "}",
  "}",
);

describe("dominators ignore unreachable predecessors", () => {
  test("a loop whose body ends in return keeps the pre-loop block as the header's dominator", async () => {
    const graph = await graphOf(ABRUPT_LOOP_TAIL);
    const before = at(graph, "ExpressionStatement", 2);
    const header = at(graph, "WhileStatement", 3);
    const after = at(graph, "ExpressionStatement", 7);

    expect(graph.unreachableBlockIds.length).toBeGreaterThan(0);
    expect(immediateDominator(graph, header.id)).toBe(before.id);
    expect(immediateDominator(graph, after.id)).toBe(header.id);
    expectReachableDominatorTree(graph);
  });

  test("switch case tails after break do not detach the next case or the continuation", async () => {
    const graph = await graphOf(SWITCH_CASE_TAILS);
    const discriminant = at(graph, "SwitchStatement", 2);
    const fallback = at(graph, "ExpressionStatement", 7);
    const after = at(graph, "ExpressionStatement", 10);

    expect(immediateDominator(graph, fallback.id)).toBe(discriminant.id);
    expect(immediateDominator(graph, after.id)).toBe(discriminant.id);
    expectReachableDominatorTree(graph);
  });

  test("labelled continue from below an abruptly exited inner loop stays in the outer natural loop", async () => {
    const graph = await graphOf(LABELLED_CONTINUE);
    const outerHeader = at(graph, "WhileStatement", 2);
    const innerHeader = at(graph, "WhileStatement", 3);
    const broken = at(graph, "BreakStatement", 4);
    const continued = at(graph, "ContinueStatement", 6);
    const outer = graph.loops.find((loop) => loop.headerBlockId === outerHeader.id);

    expect(graph.edges.filter((edge) => edge.fromBlockId === continued.id).map(({ toBlockId, kind }) => ({ toBlockId, kind })))
      .toEqual([{ toBlockId: outerHeader.id, kind: "continue" }]);
    expect(outer?.blockIds).toContain(continued.id);
    expect(outer?.blockIds).toContain(innerHeader.id);
    expect(outer?.blockIds).not.toContain(broken.id);
    expectReachableDominatorTree(graph);
  });

  test("an inner loop ending in break keeps its header under the outer loop body", async () => {
    const graph = await graphOf(NESTED_BREAK);
    const outerHeader = at(graph, "WhileStatement", 2);
    const innerHeader = at(graph, "WhileStatement", 3);
    const outerBody = graph.edges.find((edge) => edge.fromBlockId === outerHeader.id && edge.kind === "true")?.toBlockId;

    expect(outerBody).toBeDefined();
    expect(immediateDominator(graph, innerHeader.id)).toBe(outerBody);
    expectReachableDominatorTree(graph);
  });

  test("control: unreachable blocks are still listed and predecessor-free ones claim no dominator", async () => {
    for (const source of [ABRUPT_LOOP_TAIL, SWITCH_CASE_TAILS, LABELLED_CONTINUE, NESTED_BREAK]) {
      const graph = await graphOf(source);
      const live = reachable(graph);
      expect(graph.dominators.map((candidate) => candidate.blockId).sort()).toEqual(graph.blocks.map((block) => block.id).sort());
      for (const block of graph.blocks.filter((candidate) => !live.has(candidate.id) && candidate.predecessorIds.length === 0)) {
        expect(immediateDominator(graph, block.id)).toBeUndefined();
      }
    }
  });
});
