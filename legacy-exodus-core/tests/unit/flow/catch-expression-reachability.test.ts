import { describe, expect, test } from "bun:test";
import { DeterministicControlFlowGraphBuilder, type BasicBlock, type ControlFlowGraph } from "@flow/index";
import { JavaScriptParser, type ASTResult } from "@parser/index";

async function parse(source: string): Promise<ASTResult> {
  return (await new JavaScriptParser().parse({
    file: { id: "f03c", path: "src/f03c.js", language: "javascript", size: source.length }, source,
  })).result;
}
function graphFor(ast: ASTResult, builder = new DeterministicControlFlowGraphBuilder()): ControlFlowGraph {
  const graph = builder.buildAll(ast).find((candidate) => candidate.scopeName === "f@1:0");
  if (graph === undefined) throw new Error("Expected function f graph");
  return graph;
}
function blockAt(graph: ControlFlowGraph, line: number, type = "ExpressionStatement"): BasicBlock {
  const block = graph.blocks.find((candidate) => candidate.statements.some((node) => node.location?.line === line && node.type === type));
  if (block === undefined) throw new Error(`Missing ${type} at line ${line}`);
  return block;
}
function reachable(graph: ControlFlowGraph, block: BasicBlock, expected: boolean): void {
  expect(!graph.unreachableBlockIds.includes(block.id)).toBe(expected);
  for (const node of block.statements) expect(!graph.deadCodeNodeIds.includes(node.id)).toBe(expected);
}
function kinds(graph: ControlFlowGraph, from: BasicBlock, to: BasicBlock): string[] {
  return graph.edges.filter((edge) => edge.fromBlockId === from.id && edge.toBlockId === to.id).map((edge) => edge.kind);
}
function wrapped(operation: string): string {
  return `function f(obj, key, c) {\nlet x;\ntry {\n${operation}\n} catch (e) {\nrecover();\n}\n}`;
}
const positives = [
  ["T02 call control", "mayThrow();", "ExpressionStatement"],
  ["T03 canonical member", "const x = null.value;", "VariableDeclaration"],
  ["T04 computed member", "const x = null[key];", "VariableDeclaration"],
  ["T05 assignment RHS", "x = null.value;", "ExpressionStatement"],
  ["T06 return expression", "return null.value;", "ReturnStatement"],
  ["T14 unknown receiver", "obj.value;", "ExpressionStatement"],
  ["T15 apparently safe receiver", "({ value: 1 }).value;", "ExpressionStatement"],
  ["A arithmetic", "const x = null.value + 1;", "VariableDeclaration"],
  ["B chained member", "const x = null.value.deep;", "VariableDeclaration"],
  ["C primitive receiver", '"abc".length;', "ExpressionStatement"],
  ["D computed unknown receiver", "obj[key];", "ExpressionStatement"],
] as const;
const corpus = [
  wrapped("const x = null.value;"), wrapped("null[key];"), wrapped("obj.value;"),
  wrapped("return 1;\nnull.value;"), wrapped("function g() { return null.value; }"),
  "function f() { try { null.value; } finally { cleanup(); } }",
  "function f() { try { try { null.value; } catch (e) { innerRecover(); } } catch (e) { outerRecover(); } }",
];

describe("F03-C ordinary member exception reachability", () => {
  test.each(positives)("%s", async (_name, operation, type) => {
    const graph = graphFor(await parse(wrapped(operation)));
    const source = blockAt(graph, 4, type);
    const handler = blockAt(graph, 6);
    const observation = {
      edges: kinds(graph, source, handler),
      catchReachable: !graph.unreachableBlockIds.includes(handler.id),
      recoverDead: handler.statements.some((node) => graph.deadCodeNodeIds.includes(node.id)),
      state: graph.state,
    };
    expect(observation).toEqual({ edges: ["exception"], catchReachable: true, recoverDead: false, state: "RESOLVED" });
    reachable(graph, source, true);
    expect(handler.predecessorIds).toEqual([source.id]);
    expect(source.terminator).toBe(type === "ReturnStatement" ? "ReturnStatement" : undefined);
    expect(graph.edges.some((edge) => edge.fromBlockId === source.id && edge.kind === (type === "ReturnStatement" ? "return" : "next"))).toBe(true);
    expect(graph.edges.filter((edge) => edge.fromBlockId === source.id && edge.kind === "throw")).toEqual([]);
  });
  test("T01 explicit throw control", async () => {
    const graph = graphFor(await parse(wrapped("throw e;")));
    const source = blockAt(graph, 4, "ThrowStatement");
    const handler = blockAt(graph, 6);
    expect(kinds(graph, source, handler)).toEqual(["throw"]);
    expect(source.terminator).toBe("ThrowStatement");
    expect(graph.edges.filter((edge) => edge.fromBlockId === source.id).map((edge) => edge.kind)).toEqual(["throw"]);
    reachable(graph, handler, true);
  });
  test.each([
    ["T07 nested block", "{\nnull.value;\n}"],
    ["T08 reachable conditional", "if (c) {\nnull.value;\n}"],
  ])("%s", async (_name, operation) => {
    const graph = graphFor(await parse(wrapped(operation)));
    const source = blockAt(graph, 5);
    const handler = blockAt(graph, 8);
    expect(kinds(graph, source, handler)).toEqual(["exception"]);
    reachable(graph, source, true);
    reachable(graph, handler, true);
  });
  test.each([
    ["T09 dead after return", "return 1;\nnull.value;", 5, 7, false],
    ["T10 dead after throw", "throw e;\nnull.value;", 5, 7, true],
    ["T11 constant false", "if (false) {\nnull.value;\n}", 5, 8, false],
  ] as const)("%s", async (_name, operation, sourceLine, catchLine, catchReachable) => {
    const graph = graphFor(await parse(wrapped(operation)));
    const source = blockAt(graph, sourceLine);
    const handler = blockAt(graph, catchLine);
    reachable(graph, source, false);
    reachable(graph, handler, catchReachable);
    for (const edge of graph.edges.filter((edge) => edge.toBlockId === handler.id && edge.kind === "exception")) {
      expect(graph.unreachableBlockIds).toContain(edge.fromBlockId);
    }
    if (catchReachable) {
      const explicit = blockAt(graph, 4, "ThrowStatement");
      expect(kinds(graph, explicit, handler)).toEqual(["throw"]);
      expect(graph.edges.filter((edge) => edge.fromBlockId === explicit.id).map((edge) => edge.kind)).toEqual(["throw"]);
    }
  });
  test.each([
    ["T12 function declaration firewall", "function g() { return null.value; }"],
    ["T13 arrow firewall", "const g = () => null.value;"],
    ["function expression firewall", "const g = function() { return null.value; };"],
    ["class method firewall", "class G { g() { return null.value; } }"],
    ["object method firewall", "const g = { m() { return null.value; } };"],
  ])("%s", async (_name, operation) => {
    const graph = graphFor(await parse(wrapped(operation)));
    const handler = blockAt(graph, 6);
    reachable(graph, handler, false);
    expect(handler.predecessorIds).toEqual([]);
    expect(graph.edges.filter((edge) => edge.kind === "exception")).toEqual([]);
    expect(graph.state).toBe("RESOLVED");
  });
  test("T16 optional chaining is lowered; a nullish base skips the member and throws nothing", async () => {
    const graph = graphFor(await parse(wrapped("null?.value;")));
    expect(graph.state).toBe("RESOLVED");
    expect(kinds(graph, blockAt(graph, 4), blockAt(graph, 6))).toEqual([]);
    reachable(graph, blockAt(graph, 6), false);
  });
  test("T17 try catch finally composition", async () => {
    const graph = graphFor(await parse("function f() {\ntry {\nnull.value;\n} catch (e) {\nrecover();\n} finally {\ncleanup();\n}\n}"));
    const source = blockAt(graph, 3);
    const handler = blockAt(graph, 5);
    const cleanup = blockAt(graph, 7);
    expect(kinds(graph, source, handler)).toEqual(["exception"]);
    expect(kinds(graph, source, cleanup)).toEqual(["finally"]);
    expect(kinds(graph, handler, cleanup)).toEqual(["finally"]);
    reachable(graph, handler, true);
    reachable(graph, cleanup, true);
    expect(graph.state).toBe("RESOLVED");
  });
  test("T18 nearest nested handler and existing catch-call propagation", async () => {
    const graph = graphFor(await parse("function f() {\ntry {\ntry {\nnull.value;\n} catch (e) {\ninnerRecover();\n}\n} catch (e) {\nouterRecover();\n}\n}"));
    const source = blockAt(graph, 4);
    const inner = blockAt(graph, 6);
    const outer = blockAt(graph, 9);
    expect(kinds(graph, source, inner)).toEqual(["exception"]);
    expect(kinds(graph, source, outer)).toEqual([]);
    expect(outer.predecessorIds).toEqual([inner.id]);
    expect(kinds(graph, inner, outer)).toEqual(["exception"]);
    reachable(graph, inner, true);
    const isolated = graphFor(await parse("function f() {\ntry {\ntry {\nnull.value;\n} catch (e) {\nconst recovered = true;\n}\n} catch (e) {\nouterRecover();\n}\n}"));
    reachable(isolated, blockAt(isolated, 6, "VariableDeclaration"), true);
    reachable(isolated, blockAt(isolated, 9), false);
    expect(blockAt(isolated, 9).predecessorIds).toEqual([]);
  });
  test("T19 fresh and reused builder determinism across representative corpus", async () => {
    const reused = new DeterministicControlFlowGraphBuilder();
    const asts = await Promise.all(corpus.map(parse));
    const expected = asts.map((ast) => JSON.stringify(new DeterministicControlFlowGraphBuilder().buildAll(ast)));
    for (let iteration = 0; iteration < 3; iteration++) {
      for (const [index, ast] of asts.entries()) {
        const reference = expected[index];
        if (reference === undefined) throw new Error("Missing corpus reference");
        expect(JSON.stringify(new DeterministicControlFlowGraphBuilder().buildAll(ast))).toBe(reference);
        expect(JSON.stringify(reused.buildAll(ast))).toBe(reference);
      }
    }
  });
  test("T20 AST immutability across representative corpus", async () => {
    for (const source of corpus) {
      const ast = await parse(source);
      const before = JSON.stringify(ast);
      new DeterministicControlFlowGraphBuilder().buildAll(ast);
      expect(JSON.stringify(ast)).toBe(before);
    }
  });
});
