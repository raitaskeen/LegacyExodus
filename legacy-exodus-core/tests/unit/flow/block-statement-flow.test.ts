import { describe, expect, test } from "bun:test";

import { DeterministicControlFlowGraphBuilder } from "@flow/control-flow-builder";
import type { BasicBlock, ControlFlowGraph } from "@flow/flow-contracts";
import { JavaScriptParser, type ASTResult } from "@parser/index";

async function parse(body: string): Promise<ASTResult> {
  const source = `function f() {\n${body}\n}`;
  const ast = (await new JavaScriptParser().parse({
    file: { id: "block-flow", path: "src/block-flow.js", language: "javascript", size: source.length },
    source,
  })).result;
  expect(ast.errors).toEqual([]);
  return ast;
}

function functionGraph(ast: ASTResult, builder = new DeterministicControlFlowGraphBuilder()): ControlFlowGraph {
  const graph = builder.buildAll(ast).find((candidate) => candidate.scopeName.startsWith("f@"));
  if (graph === undefined) throw new Error("Expected function f CFG.");
  expect(graph.state).toBe("RESOLVED");
  return graph;
}

async function build(body: string): Promise<ControlFlowGraph> {
  return functionGraph(await parse(body));
}

function statement(graph: ControlFlowGraph, type: string, line: number): BasicBlock {
  const matches = graph.blocks.filter((block) => block.statements.some(
    (node) => node.type === type && node.location?.line === line && node.location.column === 0,
  ));
  expect(matches).toHaveLength(1);
  const block = matches[0];
  if (block === undefined) throw new Error(`Missing ${type} at ${line}:0.`);
  return block;
}

function reachability(graph: ControlFlowGraph, type: string, line: number, reachable: boolean): BasicBlock {
  const block = statement(graph, type, line);
  const node = block.statements.find((item) => item.type === type && item.location?.line === line);
  if (node === undefined) throw new Error("Missing statement identity.");
  expect(graph.unreachableBlockIds.includes(block.id)).toBe(!reachable);
  expect(graph.deadCodeNodeIds.includes(node.id)).toBe(!reachable);
  return block;
}

function noWrappers(graph: ControlFlowGraph): void {
  expect(graph.blocks.flatMap((block) => block.statements).filter((node) => node.type === "BlockStatement")).toEqual([]);
}

function outgoing(graph: ControlFlowGraph, block: BasicBlock) {
  return graph.edges.filter((edge) => edge.fromBlockId === block.id)
    .map(({ toBlockId, kind }) => ({ toBlockId, kind }));
}

describe("F03-A standalone block lowering", () => {
  test("T01 direct return control", async () => {
    const graph = await build("return 1;\nafter();");
    const returned = reachability(graph, "ReturnStatement", 2, true);
    expect(returned.terminator).toBe("ReturnStatement");
    expect(outgoing(graph, returned)).toEqual([{ toBlockId: graph.exitBlockId, kind: "return" }]);
    reachability(graph, "ExpressionStatement", 3, false);
    noWrappers(graph);
  });

  test("T02 standalone return propagates termination", async () => {
    const graph = await build("{\nreturn 1;\n}\nafter();");
    const returned = reachability(graph, "ReturnStatement", 3, true);
    expect(returned.id).toBe(graph.entryBlockId);
    expect(returned.terminator).toBe("ReturnStatement");
    expect(outgoing(graph, returned)).toEqual([{ toBlockId: graph.exitBlockId, kind: "return" }]);
    reachability(graph, "ExpressionStatement", 5, false);
    noWrappers(graph);
  });

  test("T04 ordinary block preserves same-block ordering and exit", async () => {
    const graph = await build("{\nbefore();\n}\nafter();");
    const before = reachability(graph, "ExpressionStatement", 3, true);
    const after = reachability(graph, "ExpressionStatement", 5, true);
    expect(before.id).toBe(graph.entryBlockId);
    expect(after.id).toBe(before.id);
    expect(before.statements.map((node) => node.location?.line)).toEqual([3, 5]);
    expect(before.terminator).toBeUndefined();
    expect(outgoing(graph, before)).toEqual([{ toBlockId: graph.exitBlockId, kind: "next" }]);
    expect(graph.blocks).toHaveLength(2);
    noWrappers(graph);
  });

  test("T05 partial return preserves false-path continuation", async () => {
    const graph = await build("{\nif (c) {\nreturn 1;\n}\n}\nafter();");
    const branch = reachability(graph, "IfStatement", 3, true);
    const returned = reachability(graph, "ReturnStatement", 4, true);
    const after = reachability(graph, "ExpressionStatement", 7, true);
    const falseEdge = graph.edges.find((edge) => edge.fromBlockId === branch.id && edge.kind === "false");
    expect(falseEdge).toBeDefined();
    expect(graph.edges.some((edge) => edge.fromBlockId === falseEdge?.toBlockId && edge.toBlockId === after.id && edge.kind === "next")).toBe(true);
    expect(outgoing(graph, returned)).toEqual([{ toBlockId: graph.exitBlockId, kind: "return" }]);
    noWrappers(graph);
  });

  test("T06 all branches terminating leave continuation unreachable", async () => {
    const graph = await build("{\nif (c) {\nreturn 1;\n} else {\nreturn 2;\n}\n}\nafter();");
    for (const line of [4, 6]) {
      const returned = reachability(graph, "ReturnStatement", line, true);
      expect(returned.terminator).toBe("ReturnStatement");
      expect(outgoing(graph, returned)).toEqual([{ toBlockId: graph.exitBlockId, kind: "return" }]);
    }
    const after = reachability(graph, "ExpressionStatement", 9, false);
    expect(after.predecessorIds).toEqual([]);
    noWrappers(graph);
  });
});

describe("F03-A completion, context, and adversarial controls", () => {
  test.each([2, 3, 5])("T03 nested return at depth %i", async (depth) => {
    const graph = await build([...Array<string>(depth).fill("{"), "return 1;", ...Array<string>(depth).fill("}"), "after();"].join("\n"));
    const returned = reachability(graph, "ReturnStatement", depth + 2, true);
    expect(returned.terminator).toBe("ReturnStatement");
    expect(outgoing(graph, returned)).toEqual([{ toBlockId: graph.exitBlockId, kind: "return" }]);
    reachability(graph, "ExpressionStatement", depth * 2 + 3, false);
    noWrappers(graph);
  });

  test("T07 standalone throw has no normal fallthrough", async () => {
    const graph = await build("{\nthrow error;\n}\nafter();");
    const thrown = reachability(graph, "ThrowStatement", 3, true);
    expect(thrown.terminator).toBe("ThrowStatement");
    expect(outgoing(graph, thrown)).toEqual([{ toBlockId: graph.exitBlockId, kind: "throw" }]);
    reachability(graph, "ExpressionStatement", 5, false);
    noWrappers(graph);
  });

  test("T08 declaration and expression ordering", async () => {
    const graph = await build("{\nconst x = 1;\nuse(x);\n}\nafter();");
    const declaration = reachability(graph, "VariableDeclaration", 3, true);
    const use = reachability(graph, "ExpressionStatement", 4, true);
    const after = reachability(graph, "ExpressionStatement", 6, true);
    expect([declaration.id, use.id, after.id]).toEqual(Array<string>(3).fill(graph.entryBlockId));
    expect(declaration.statements.map((node) => [node.type, node.location?.line])).toEqual([
      ["VariableDeclaration", 3], ["ExpressionStatement", 4], ["ExpressionStatement", 6],
    ]);
    noWrappers(graph);
  });

  test.each([1, 3])("T09 %i empty blocks preserve clean fallthrough", async (count) => {
    const graph = await build([...Array<string>(count).fill("{}"), "after();"].join("\n"));
    const after = reachability(graph, "ExpressionStatement", count + 2, true);
    expect(after.id).toBe(graph.entryBlockId);
    expect(graph.blocks).toHaveLength(2);
    expect(graph.unreachableBlockIds).toEqual([]);
    expect(graph.deadCodeNodeIds).toEqual([]);
    expect(outgoing(graph, after)).toEqual([{ toBlockId: graph.exitBlockId, kind: "next" }]);
    noWrappers(graph);
  });

  test("T10 prior statement and block return share the current block", async () => {
    const graph = await build("before();\n{\nreturn 1;\n}\nafter();");
    const before = reachability(graph, "ExpressionStatement", 2, true);
    const returned = reachability(graph, "ReturnStatement", 4, true);
    expect(before.id).toBe(returned.id);
    expect(before.statements.map((node) => node.location?.line)).toEqual([2, 4]);
    expect(outgoing(graph, returned)).toEqual([{ toBlockId: graph.exitBlockId, kind: "return" }]);
    reachability(graph, "ExpressionStatement", 6, false);
    noWrappers(graph);
  });

  test.each(["hidden();", "a();\nb();"])("T11 dead block does not revive %s", async (body) => {
    const graph = await build(`return 1;\n{\n${body}\n}`);
    const returned = reachability(graph, "ReturnStatement", 2, true);
    expect(outgoing(graph, returned)).toEqual([{ toBlockId: graph.exitBlockId, kind: "return" }]);
    for (let index = 0; index < body.split("\n").length; index++) {
      const hidden = reachability(graph, "ExpressionStatement", index + 4, false);
      expect(hidden.predecessorIds).toEqual([]);
    }
    noWrappers(graph);
  });

  test("T12 nested break routes to loop continuation", async () => {
    const graph = await build("while (true) {\n{\nbreak;\n}\nafter();\n}\ndone();");
    const broken = reachability(graph, "BreakStatement", 4, true);
    const done = reachability(graph, "ExpressionStatement", 8, true);
    expect(broken.terminator).toBe("BreakStatement");
    expect(outgoing(graph, broken)).toEqual([{ toBlockId: done.id, kind: "break" }]);
    reachability(graph, "ExpressionStatement", 6, false);
    noWrappers(graph);
  });

  test("T13 nested continue routes to existing loop header", async () => {
    const graph = await build("while (condition) {\n{\ncontinue;\n}\nafter();\n}\ndone();");
    const header = reachability(graph, "WhileStatement", 2, true);
    const continued = reachability(graph, "ContinueStatement", 4, true);
    const done = reachability(graph, "ExpressionStatement", 8, true);
    expect(continued.terminator).toBe("ContinueStatement");
    expect(outgoing(graph, continued)).toEqual([{ toBlockId: header.id, kind: "continue" }]);
    expect(graph.edges.some((edge) => edge.fromBlockId === header.id && edge.toBlockId === done.id && edge.kind === "false")).toBe(true);
    reachability(graph, "ExpressionStatement", 6, false);
    noWrappers(graph);
  });

  test("T14 nested labeled break routes past its label", async () => {
    const graph = await build("outer: {\n{\nbreak outer;\n}\nafter();\n}\ndone();");
    const broken = reachability(graph, "BreakStatement", 4, true);
    const done = reachability(graph, "ExpressionStatement", 8, true);
    expect(broken.terminator).toBe("BreakStatement");
    expect(outgoing(graph, broken)).toEqual([{ toBlockId: done.id, kind: "break" }]);
    reachability(graph, "ExpressionStatement", 6, false);
    noWrappers(graph);
  });

  test("T15 return executes finally before function exit", async () => {
    const ast = await parse("{\ntry {\nreturn 1;\n} finally {\ncleanup();\n}\n}\nafter();");
    const snapshot = JSON.stringify(ast);
    const graph = functionGraph(ast);
    const returned = reachability(graph, "ReturnStatement", 4, true);
    const cleanup = reachability(graph, "ExpressionStatement", 6, true);
    expect(returned.terminator).toBe("ReturnStatement");
    expect(outgoing(graph, returned)).toEqual([{ toBlockId: cleanup.id, kind: "finally" }]);
    expect(outgoing(graph, cleanup)).toEqual([{ toBlockId: graph.exitBlockId, kind: "return" }]);
    const after = reachability(graph, "ExpressionStatement", 9, false);

    // buildTry owns the finalizer marker; only the ordinary outer wrapper is elided.
    const astNodes = [ast.root];
    for (let index = 0; index < astNodes.length; index++) {
      const node = astNodes[index];
      if (node !== undefined) astNodes.push(...node.children);
    }
    const outer = astNodes.find((node) => node.type === "BlockStatement" && node.location?.start.line === 2);
    const finalizer = astNodes.find((node) => node.type === "BlockStatement" && node.role === "finalizer");
    if (outer?.location === undefined || finalizer?.location === undefined) throw new Error("Missing T15 AST blocks.");
    expect(outer.location.start).toEqual({ line: 2, column: 0 });
    expect(finalizer.location.start).toEqual({ line: 5, column: 10 });
    const { createHash } = await import("node:crypto");
    const outerId = createHash("sha256").update(`${ast.metadata.sourcePath}:${outer.type}:2:0`).digest("hex");
    const finalizerId = createHash("sha256")
      .update(`${ast.metadata.sourcePath}:${finalizer.type}:${finalizer.location.start.line}:${finalizer.location.start.column}`)
      .digest("hex");
    const statements = graph.blocks.flatMap((block) => block.statements);
    expect(statements.some((node) => node.id === outerId)).toBe(false);
    expect(statements.filter((node) => node.type === "BlockStatement")).toEqual([
      { id: finalizerId, type: "BlockStatement", location: finalizer.location.start },
    ]);
    expect(cleanup.statements.map((node) => node.type)).toEqual(["BlockStatement", "ExpressionStatement"]);
    expect(cleanup.statements[0]?.id).toBe(finalizerId);
    expect(statements.filter((node) => node.type === "ReturnStatement")).toHaveLength(1);
    expect(statements.filter((node) => node.type === "ExpressionStatement" && node.location?.line === 6)).toHaveLength(1);
    expect(after.statements).toHaveLength(1);
    expect(graph.unreachableBlockIds).toEqual([after.id]);
    expect(graph.deadCodeNodeIds).toEqual(after.statements.map((node) => node.id));

    // Removing the cleanup block must disconnect function entry from exit.
    const reachableWithoutCleanup = new Set<string>();
    const pending = [graph.entryBlockId];
    while (pending.length > 0) {
      const blockId = pending.pop();
      if (blockId === undefined || blockId === cleanup.id || reachableWithoutCleanup.has(blockId)) continue;
      reachableWithoutCleanup.add(blockId);
      for (const edge of graph.edges) if (edge.fromBlockId === blockId) pending.push(edge.toBlockId);
    }
    expect(reachableWithoutCleanup.has(returned.id)).toBe(true);
    expect(reachableWithoutCleanup.has(graph.exitBlockId)).toBe(false);
    expect(JSON.stringify(ast)).toBe(snapshot);
  });

  test("self-review partial nested branch retains normal completion", async () => {
    const graph = await build("{\nif (a) {\nif (b) {\nreturn 1;\n}\n}\n}\nafter();");
    reachability(graph, "IfStatement", 3, true);
    reachability(graph, "IfStatement", 4, true);
    const returned = reachability(graph, "ReturnStatement", 5, true);
    expect(outgoing(graph, returned)).toEqual([{ toBlockId: graph.exitBlockId, kind: "return" }]);
    reachability(graph, "ExpressionStatement", 9, true);
    noWrappers(graph);
  });

  test("self-review mixed return and nested throw terminate all paths", async () => {
    const graph = await build("{\nif (a) {\nreturn 1;\n} else {\n{\nthrow error;\n}\n}\n}\nafter();");
    const returned = reachability(graph, "ReturnStatement", 4, true);
    const thrown = reachability(graph, "ThrowStatement", 7, true);
    expect(outgoing(graph, returned)).toEqual([{ toBlockId: graph.exitBlockId, kind: "return" }]);
    expect(outgoing(graph, thrown)).toEqual([{ toBlockId: graph.exitBlockId, kind: "throw" }]);
    reachability(graph, "ExpressionStatement", 11, false);
    noWrappers(graph);
  });

  test("T16 fresh and reused builders are deterministic and preserve AST", async () => {
    const bodies = [
      "{\n{\nreturn 1;\n}\n}\nafter();",
      "{}\n{\nbefore();\n}\nafter();",
      "{\nif (a) {\nreturn 1;\n}\n}\nafter();",
      "while (condition) {\n{\ncontinue;\n}\nafter();\n}\ndone();",
      "{\ntry {\nreturn 1;\n} finally {\ncleanup();\n}\n}\nafter();",
    ];
    const asts = await Promise.all(bodies.map(parse));
    const snapshots = asts.map((ast) => JSON.stringify(ast));
    const expected = asts.map((ast) => JSON.stringify(functionGraph(ast)));
    const reused = new DeterministicControlFlowGraphBuilder();
    for (let run = 0; run < 3; run++) {
      for (const [index, ast] of asts.entries()) {
        const expectedGraph = expected[index];
        const snapshot = snapshots[index];
        if (expectedGraph === undefined || snapshot === undefined) throw new Error("Missing determinism control.");
        expect(JSON.stringify(functionGraph(ast))).toBe(expectedGraph);
        expect(JSON.stringify(functionGraph(ast, reused))).toBe(expectedGraph);
        expect(JSON.stringify(ast)).toBe(snapshot);
      }
    }
  });
});
