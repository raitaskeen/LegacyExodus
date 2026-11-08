import { describe, expect, test } from "bun:test";

import { DeterministicControlFlowGraphBuilder, type BasicBlock, type ControlFlowGraph } from "@flow/index";
import { JavaScriptParser } from "@parser/index";

async function buildGraph(source: string): Promise<ControlFlowGraph> {
  const ast = (await new JavaScriptParser().parse({
    file: { id: "catch-reachability", path: "src/catch-reachability.js", language: "javascript", size: source.length },
    source,
  })).result;

  return new DeterministicControlFlowGraphBuilder().build(ast);
}

function statementBlock(graph: ControlFlowGraph, type: string, line: number): BasicBlock {
  const block = graph.blocks.find((candidate) => candidate.statements.some(
    (statement) => statement.type === type && statement.location?.line === line,
  ));
  if (block === undefined) throw new Error(`Expected ${type} block at line ${line}.`);
  return block;
}

describe("IA-HIGH-007 catch reachability for potential throws", () => {
  test.each([
    ["direct call", "mayThrow();"],
    ["member call", "service.mayThrow();"],
    ["constructor call", "new Service();"],
  ])("routes a potentially throwing %s to catch conservatively", async (_label, operation): Promise<void> => {
    const source = `try {\n  ${operation}\n} catch (error) {\n  recover(error);\n}`;
    const first = await buildGraph(source);
    const second = await buildGraph(source);
    const operationBlock = statementBlock(first, "ExpressionStatement", 2);
    const catchBlock = statementBlock(first, "ExpressionStatement", 4);

    expect(first.edges
      .filter((edge) => edge.fromBlockId === operationBlock.id && edge.toBlockId === catchBlock.id)
      .map(({ fromBlockId, toBlockId, kind }) => ({ fromBlockId, toBlockId, kind }))).toEqual([
      { fromBlockId: operationBlock.id, toBlockId: catchBlock.id, kind: "exception" },
    ]);
    expect(catchBlock.predecessorIds).toEqual([operationBlock.id]);
    expect(first.unreachableBlockIds).not.toContain(catchBlock.id);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  test("preserves explicit throw transfer to catch", async (): Promise<void> => {
    const graph = await buildGraph("try {\n  throw error;\n} catch (caught) {\n  recover(caught);\n}");
    const throwBlock = statementBlock(graph, "ThrowStatement", 2);
    const catchBlock = statementBlock(graph, "ExpressionStatement", 4);

    expect(graph.edges
      .filter((edge) => edge.fromBlockId === throwBlock.id && edge.toBlockId === catchBlock.id)
      .map(({ fromBlockId, toBlockId, kind }) => ({ fromBlockId, toBlockId, kind }))).toEqual([
      { fromBlockId: throwBlock.id, toBlockId: catchBlock.id, kind: "throw" },
    ]);
    expect(graph.unreachableBlockIds).not.toContain(catchBlock.id);
  });

  test("does not fabricate potential exceptions for simple expressions", async (): Promise<void> => {
    const graph = await buildGraph("try {\n  const value = 1 + 2;\n} catch (error) {\n  recover(error);\n}");
    const declarationBlock = statementBlock(graph, "VariableDeclaration", 2);
    const catchBlock = statementBlock(graph, "ExpressionStatement", 4);

    expect(graph.edges.filter((edge) => edge.fromBlockId === declarationBlock.id && edge.kind === "exception")).toEqual([]);
    expect(catchBlock.predecessorIds).toEqual([]);
    expect(graph.unreachableBlockIds).toContain(catchBlock.id);
  });

  test("leaves ordinary invocation flow outside try/catch unchanged", async (): Promise<void> => {
    const graph = await buildGraph("mayThrow();\nafter();");

    expect(graph.edges.filter((edge) => edge.kind === "exception")).toEqual([]);
    expect(graph.unreachableBlockIds).toEqual([]);
  });

  test("keeps catch and finally reachable after a potential throw", async (): Promise<void> => {
    const graph = await buildGraph("try {\n  mayThrow();\n} catch (error) {\n  recover(error);\n} finally {\n  cleanup();\n}");
    const operationBlock = statementBlock(graph, "ExpressionStatement", 2);
    const catchBlock = statementBlock(graph, "ExpressionStatement", 4);
    const exceptionEdge = graph.edges.find((edge) => edge.fromBlockId === operationBlock.id && edge.kind === "exception");
    const catchFinalizerEdge = graph.edges.find((edge) => edge.fromBlockId === catchBlock.id && edge.kind === "finally");

    expect(exceptionEdge?.toBlockId).toBe(catchBlock.id);
    expect(catchFinalizerEdge?.toBlockId).not.toBe(catchBlock.id);
    expect(graph.unreachableBlockIds).not.toContain(catchBlock.id);
  });

  test("keeps catch reachable for a call inside a nested block", async (): Promise<void> => {
    const graph = await buildGraph("try {\n  {\n    mayThrow();\n  }\n} catch (error) {\n  recover(error);\n}");
    const nestedBlock = statementBlock(graph, "ExpressionStatement", 3);
    const catchBlock = statementBlock(graph, "ExpressionStatement", 6);

    expect(graph.edges
      .filter((edge) => edge.fromBlockId === nestedBlock.id && edge.toBlockId === catchBlock.id)
      .map(({ fromBlockId, toBlockId, kind }) => ({ fromBlockId, toBlockId, kind }))).toEqual([
      { fromBlockId: nestedBlock.id, toBlockId: catchBlock.id, kind: "exception" },
    ]);
    expect(catchBlock.predecessorIds).toEqual([nestedBlock.id]);
    expect(graph.unreachableBlockIds).not.toContain(catchBlock.id);
  });

  test("classifies potential exceptional entry into a nested finalizer as finally", async (): Promise<void> => {
    const graph = await buildGraph("try {\n  try {\n    mayThrow();\n  } finally {\n    const cleaned = true;\n  }\n} catch (error) {\n  recover(error);\n}");
    const operationBlock = statementBlock(graph, "ExpressionStatement", 3);
    const catchBlock = statementBlock(graph, "ExpressionStatement", 8);
    const finalizerEntry = graph.edges.find((edge) => edge.fromBlockId === operationBlock.id && graph.edges.some(
      (candidate) => candidate.fromBlockId === edge.toBlockId && candidate.toBlockId === catchBlock.id && candidate.kind === "throw",
    ));
    if (finalizerEntry === undefined) throw new Error("Expected potential exceptional entry into the nested finalizer.");
    const finalizerBlock = graph.blocks.find((block) => block.id === finalizerEntry.toBlockId);
    if (finalizerBlock === undefined) throw new Error("Expected the exceptional finalizer block.");

    expect({
      fromBlockId: finalizerEntry.fromBlockId,
      toBlockId: finalizerEntry.toBlockId,
      kind: finalizerEntry.kind,
    }).toEqual({
      fromBlockId: operationBlock.id,
      toBlockId: finalizerBlock.id,
      kind: "finally",
    });
    expect(finalizerBlock.statements.some((statement) => statement.type === "VariableDeclaration" && statement.location?.line === 5)).toBe(true);
    expect(graph.edges
      .filter((edge) => edge.fromBlockId === finalizerBlock.id && edge.toBlockId === catchBlock.id)
      .map(({ fromBlockId, toBlockId, kind }) => ({ fromBlockId, toBlockId, kind }))).toEqual([
      { fromBlockId: finalizerBlock.id, toBlockId: catchBlock.id, kind: "throw" },
    ]);
    expect(graph.edges.filter((edge) => edge.fromBlockId === operationBlock.id && edge.toBlockId === catchBlock.id)).toEqual([]);
    expect(graph.unreachableBlockIds).not.toContain(catchBlock.id);
  });
});
