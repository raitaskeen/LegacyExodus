import { describe, expect, test } from "bun:test";

import { DeterministicControlFlowGraphBuilder, type BasicBlock, type ControlFlowGraph } from "@flow/index";
import { JavaScriptParser } from "@parser/index";

async function graphOf(source: string, scope = "run@"): Promise<ControlFlowGraph> {
  const ast = (await new JavaScriptParser().parse({
    file: { id: "expression-control", path: "src/expression-control.js", language: "javascript", size: source.length },
    source,
  })).result;
  const graph = new DeterministicControlFlowGraphBuilder().buildAll(ast).find((candidate) => candidate.scopeName.startsWith(scope));
  if (graph === undefined) throw new Error(`Missing graph ${scope}`);
  return graph;
}
function holding(graph: ControlFlowGraph, type: string, column?: number): BasicBlock {
  const block = graph.blocks.find((candidate) => candidate.statements.some((node) => node.type === type && (column === undefined || node.location?.column === column)));
  if (block === undefined) throw new Error(`No block holds ${type}${column === undefined ? "" : `@${column}`}`);
  return block;
}
function edge(graph: ControlFlowGraph, from: BasicBlock, kind: string): string {
  const found = graph.edges.filter((candidate) => candidate.fromBlockId === from.id && candidate.kind === kind);
  expect(found).toHaveLength(1);
  return found[0]!.toBlockId;
}
const column = (source: string, text: string): number => source.indexOf(text);

describe("CFG expression-level control (branches inside expressions)", () => {
  test.each([
    ["logical AND", "flag && doWork();", "LogicalExpression", "true"],
    ["logical OR", "flag || doWork();", "LogicalExpression", "false"],
    ["nullish coalescing", "flag ?? doWork();", "LogicalExpression", "false"],
    ["short-circuit assignment", "flag &&= doWork();", "AssignmentExpression", "true"],
  ] as const)("%s: the operand is evaluated only on its edge, then both paths join", async (_label, expression, decisionType, evaluatesOn) => {
    const source = `function run(flag) { ${expression} return 1; }`;
    const graph = await graphOf(source);
    expect(graph.state).toBe("RESOLVED");
    const decision = holding(graph, decisionType);
    const arm = holding(graph, "CallExpression", column(source, "doWork"));
    expect(edge(graph, decision, evaluatesOn)).toBe(arm.id);
    const join = edge(graph, decision, evaluatesOn === "true" ? "false" : "true");
    expect(edge(graph, arm, "next")).toBe(join);
    expect(holding(graph, "ExpressionStatement").id).toBe(join);
  });

  test("conditional expression: one arm per branch, joined before the statement completes", async () => {
    const source = "function run(flag) { flag ? doWork() : recover(); return 1; }";
    const graph = await graphOf(source);
    expect(graph.state).toBe("RESOLVED");
    const decision = holding(graph, "ConditionalExpression");
    const yes = holding(graph, "CallExpression", column(source, "doWork"));
    const no = holding(graph, "CallExpression", column(source, "recover"));
    expect(edge(graph, decision, "true")).toBe(yes.id);
    expect(edge(graph, decision, "false")).toBe(no.id);
    expect(edge(graph, yes, "next")).toBe(edge(graph, no, "next"));
    expect(holding(graph, "ExpressionStatement").id).toBe(edge(graph, yes, "next"));
  });

  test("optional call: a nullish receiver skips the call", async () => {
    const source = "function run(service) { service?.doWork(); return 1; }";
    const graph = await graphOf(source);
    expect(graph.state).toBe("RESOLVED");
    const decision = holding(graph, "OptionalMemberExpression");
    const call = holding(graph, "OptionalCallExpression");
    expect(edge(graph, decision, "true")).toBe(call.id);
    const end = edge(graph, decision, "false");
    expect(edge(graph, call, "next")).toBe(end);
    expect(holding(graph, "ExpressionStatement").id).toBe(end);
  });

  test("nested control and statement positions (if test, return, declaration) are all lowered", async () => {
    const graph = await graphOf("function run(a, b, c) { const x = a ? b ?? 1 : c; if (a && b) { go(); } return c?.d || x; }");
    expect(graph.state).toBe("RESOLVED");
    // Decisions: `?:`, `??`, `&&`, `?.`, `||` and the if itself, each a block with a true and a false exit.
    const exits = (block: BasicBlock): string[] => graph.edges.filter((candidate) => candidate.fromBlockId === block.id).map((candidate) => candidate.kind);
    expect(graph.blocks.filter((block) => exits(block).includes("true") && exits(block).includes("false"))).toHaveLength(6);
    // The if completes after its lowered test: its own true/false edges leave the block that holds it.
    const ifBlock = holding(graph, "IfStatement");
    expect(graph.edges.filter((candidate) => candidate.fromBlockId === ifBlock.id).map((candidate) => candidate.kind).sort()).toEqual(["false", "true"]);
  });

  test("a loop test is lowered from the header, which stays the loop-back target", async () => {
    const graph = await graphOf("function run(a, b) { while (a && b()) { a = next(a); } return a; }");
    expect(graph.state).toBe("RESOLVED");
    expect(graph.loops).toHaveLength(1);
    const header = graph.loops[0]!.headerBlockId;
    expect(holding(graph, "LogicalExpression").id).toBe(header);
    const loopBlock = holding(graph, "WhileStatement");
    expect(graph.edges.some((candidate) => candidate.fromBlockId === loopBlock.id && candidate.kind === "false")).toBe(true);
    expect(graph.edges.some((candidate) => candidate.toBlockId === header && candidate.kind === "loop-back")).toBe(true);
  });

  test("is deterministic", async () => {
    const source = "function run(a, b) { return a?.b ? b || 1 : a ?? 2; }";
    expect(JSON.stringify(await graphOf(source))).toBe(JSON.stringify(await graphOf(source)));
  });

  test.each([
    ["a switch case test", "switch (a) { case b ?? 1: go(); }"],
    ["a class field initializer", "class A { x = a ?? b; }"],
  ])("control in %s is not lowered yet, so the graph stays UNSUPPORTED", async (_label, statement) => {
    expect((await graphOf(`function run(a, b) { ${statement} return 1; }`)).state).toBe("UNSUPPORTED");
  });

  test("statement-level conditional control is unchanged", async () => {
    const graph = await graphOf("function run(flag) { if (flag) { doWork(); } return 1; }");
    expect(graph.state).toBe("RESOLVED");
    expect(graph.edges.filter((candidate) => candidate.kind === "true")).toHaveLength(1);
    expect(graph.edges.filter((candidate) => candidate.kind === "false")).toHaveLength(1);
  });
});
