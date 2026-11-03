import { describe, expect, test } from "bun:test";

import { DeterministicControlFlowGraphBuilder, type BasicBlock, type ControlFlowGraph } from "@flow/index";
import { JavaScriptParser } from "@parser/index";

/** Review of #237/#240: code that must be in a CFG, and control positions every graph must model. */

async function graphsOf(source: string, language: "javascript" | "typescript" = "javascript"): Promise<readonly ControlFlowGraph[]> {
  const path = language === "typescript" ? "src/c.ts" : "src/c.js";
  const ast = (await new JavaScriptParser().parse({ file: { id: path, path, language, size: source.length }, source })).result;
  return new DeterministicControlFlowGraphBuilder().buildAll(ast);
}
async function graphOf(source: string, scope: string, language: "javascript" | "typescript" = "javascript"): Promise<ControlFlowGraph> {
  const graph = (await graphsOf(source, language)).find((candidate) => candidate.scopeName.startsWith(scope));
  if (graph === undefined) throw new Error(`Missing graph ${scope}`);
  return graph;
}
const kinds = (graph: ControlFlowGraph): string[] => graph.edges.map((edge) => edge.kind).sort();
const holding = (graph: ControlFlowGraph, type: string, line?: number): BasicBlock => {
  const block = graph.blocks.find((candidate) => candidate.statements.some((node) => node.type === type && (line === undefined || node.location?.line === line)));
  if (block === undefined) throw new Error(`No block holds ${type}`);
  return block;
};
const exceptionFrom = (graph: ControlFlowGraph, block: BasicBlock): boolean => graph.edges.some((edge) => edge.fromBlockId === block.id && edge.kind === "exception");

describe("CFG coverage", () => {
  test("a #private method body has a graph of its own", async () => {
    const graph = await graphOf("class A { #priv(x) { if (x) { return 1; } return 2; } }", "#priv@");
    expect(graph.state).toBe("RESOLVED");
    expect(kinds(graph).filter((kind) => kind === "return")).toHaveLength(2);
  });

  test("a class static block has a graph of its own", async () => {
    const graph = await graphOf("class A { static { if (globalThis.y) { setup(); } } }", "static@");
    expect(graph.blocks.some((block) => block.statements.some((node) => node.type === "IfStatement"))).toBe(true);
  });

  test("a parameter default is a branch taken only for an undefined argument", async () => {
    const graph = await graphOf("function run(a = make()) { return a; }", "run@");
    expect(graph.state).toBe("RESOLVED");
    const decision = holding(graph, "AssignmentPattern");
    const arm = graph.edges.find((edge) => edge.fromBlockId === decision.id && edge.kind === "true")!.toBlockId;
    expect(graph.blocks.find((block) => block.id === arm)!.statements.map((node) => node.type)).toEqual(["CallExpression"]);
    expect(graph.edges.some((edge) => edge.fromBlockId === decision.id && edge.kind === "false")).toBe(true);
  });

  test("a destructuring default is decided after the value it destructures is evaluated", async () => {
    const graph = await graphOf("function run(o) { const { b = o.x ?? 1 } = load(o); return b; }", "run@");
    expect(graph.state).toBe("RESOLVED");
    // The `??` sits inside the default's arm: it is reached only through the default's `true` edge.
    const defaultDecision = holding(graph, "AssignmentPattern");
    const nullish = holding(graph, "LogicalExpression");
    const arm = graph.edges.find((edge) => edge.fromBlockId === defaultDecision.id && edge.kind === "true")!.toBlockId;
    expect(nullish.id).toBe(arm);
  });

  test("a TS non-null assertion inside an optional chain keeps the chain: a nullish base skips the rest", async () => {
    const graph = await graphOf("function run(a: any) { const v = a?.b!.c; return v; }", "run@", "typescript");
    // The link's decision block is the one holding an OptionalMemberExpression with a `false` (nullish) exit.
    const end = graph.edges.find((edge) => edge.kind === "false" && graph.blocks.find((block) => block.id === edge.fromBlockId)!.statements.some((node) => node.type === "OptionalMemberExpression"))!.toBlockId;
    expect(holding(graph, "VariableDeclaration").id).toBe(end);
  });
});

describe("CFG lowering positions", () => {
  test("do-while test: lowered from the condition block; the loop repeats from the completed test", async () => {
    const graph = await graphOf("function run(a, b) { do { a = step(a); } while (a && b(a)); return a; }", "run@");
    expect(graph.state).toBe("RESOLVED");
    expect(graph.loops).toHaveLength(1);
    expect(kinds(graph).filter((kind) => kind === "true")).toHaveLength(2);
  });

  test("for init and update clauses, and a for-of left, are lowered", async () => {
    expect((await graphOf("function run(n, m) { for (let i = n ?? 0; i < 3; i = i + (m || 1)) { go(i); } }", "run@")).state).toBe("RESOLVED");
    expect((await graphOf("function run(xs) { for (const { a = 1 } of xs) { go(a); } }", "run@")).state).toBe("RESOLVED");
  });

  test("a switch discriminant is lowered before the switch dispatches", async () => {
    const graph = await graphOf("function run(a) { switch (a ?? 0) { case 1: return 1; } return 0; }", "run@");
    expect(graph.state).toBe("RESOLVED");
    expect(graph.edges.some((edge) => edge.fromBlockId === holding(graph, "SwitchStatement").id && edge.kind === "case")).toBe(true);
  });

  test("inside try, a throwing arm has its own exception edge; the statement keeps its own", async () => {
    const graph = await graphOf("function run(flag) {\n  try {\n    flag ? risky() : 1;\n  } catch (e) {\n    recover();\n  }\n}", "run@");
    const riskyArm = holding(graph, "CallExpression", 3);
    expect(exceptionFrom(graph, riskyArm)).toBe(true);
    expect(exceptionFrom(graph, holding(graph, "ExpressionStatement", 3))).toBe(true);
    // The literal arm cannot throw, so it has no exception edge.
    expect(exceptionFrom(graph, holding(graph, "NumericLiteral", 3))).toBe(false);
  });
});
