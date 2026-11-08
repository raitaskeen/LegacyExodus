import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { DeterministicControlFlowGraphBuilder } from "@flow/control-flow-builder";
import type { BasicBlock, ControlFlowEdgeKind, ControlFlowGraph } from "@flow/flow-contracts";
import { JavaScriptParser, type ASTResult } from "@parser/index";

// F-003: a while/for/for-in/for-of loop owns a fresh header block that holds only its test.
// Pre-loop code (preceding statements, `for` init, the iterated expression) runs once and is
// outside every natural loop; a `for` update has its own block, which `continue` targets.

const HEADER_LOOPS = ["WhileStatement", "ForStatement", "ForInStatement", "ForOfStatement"];

async function parse(source: string): Promise<ASTResult> {
  const ast = (await new JavaScriptParser().parse({
    file: { id: "loop-header", path: "src/loop-header.js", language: "javascript", size: source.length }, source,
  })).result;
  expect(ast.errors).toEqual([]);
  return ast;
}

async function graphOf(source: string, scope = "f@", builder = new DeterministicControlFlowGraphBuilder()): Promise<ControlFlowGraph> {
  const graph = builder.buildAll(await parse(source)).find((item) => item.scopeName.startsWith(scope));
  if (graph === undefined) throw new Error(`Missing ${scope} CFG`);
  expect(graph.state).toBe("RESOLVED");
  return graph;
}

function lines(...source: readonly string[]): string {
  return source.join("\n");
}

/** The unique block that holds a node of `type` starting on `line` (and `column`, when given). */
function at(graph: ControlFlowGraph, type: string, line: number, column?: number): BasicBlock {
  const matches = graph.blocks.filter((block) => block.statements.some(
    (node) => node.type === type && node.location?.line === line && (column === undefined || node.location.column === column),
  ));
  expect(matches).toHaveLength(1);
  const block = matches[0];
  if (block === undefined) throw new Error(`Missing ${type} at ${line}`);
  return block;
}

function blockById(graph: ControlFlowGraph, id: string): BasicBlock {
  const block = graph.blocks.find((candidate) => candidate.id === id);
  if (block === undefined) throw new Error(`Missing block ${id}`);
  return block;
}

function outgoing(graph: ControlFlowGraph, block: BasicBlock) {
  return graph.edges.filter((edge) => edge.fromBlockId === block.id)
    .map(({ toBlockId, kind }) => ({ toBlockId, kind }))
    .sort((left, right) => `${left.kind}:${left.toBlockId}`.localeCompare(`${right.kind}:${right.toBlockId}`));
}

function incoming(graph: ControlFlowGraph, blockId: string) {
  return graph.edges.filter((edge) => edge.toBlockId === blockId);
}

function successor(graph: ControlFlowGraph, block: BasicBlock, kind: string): BasicBlock {
  const targets = outgoing(graph, block).filter((edge) => edge.kind === kind);
  expect(targets).toHaveLength(1);
  return blockById(graph, targets[0]?.toBlockId ?? "");
}

/** Headers of every natural loop that contains `block`. */
function loopsContaining(graph: ControlFlowGraph, block: BasicBlock): readonly string[] {
  return graph.loops.filter((loop) => loop.blockIds.includes(block.id)).map((loop) => loop.headerBlockId).sort();
}

function loopOf(graph: ControlFlowGraph, header: BasicBlock) {
  const loop = graph.loops.find((candidate) => candidate.headerBlockId === header.id);
  if (loop === undefined) throw new Error(`Missing natural loop for header ${header.id}`);
  return loop;
}

function immediateDominator(graph: ControlFlowGraph, block: BasicBlock): string | undefined {
  return graph.dominators.find((candidate) => candidate.blockId === block.id)?.immediateDominatorId;
}

function types(block: BasicBlock): readonly string[] {
  return block.statements.map((node) => node.type);
}

/** Invariants that must hold for every CFG this builder emits. */
function expectLoopStructure(graph: ControlFlowGraph): void {
  expect(incoming(graph, graph.entryBlockId)).toEqual([]);
  expect(blockById(graph, graph.entryBlockId).predecessorIds).toEqual([]);
  for (const loop of graph.loops) expect(loop.blockIds).not.toContain(graph.entryBlockId);
  for (const edge of graph.edges.filter((candidate) => candidate.kind === "loop-back")) {
    const header = blockById(graph, edge.toBlockId);
    expect(header.statements).toHaveLength(1);
    expect(HEADER_LOOPS).toContain(header.statements[0]?.type ?? "");
  }
}

const WHILE = lines(
  "function f(c) {",
  "before();",
  "while (c) {",
  "body();",
  "}",
  "after();",
  "}",
);

const FOR = lines(
  "function f(n) {",
  "before();",
  "for (let i = 0; i < n; i++) {",
  "if (skip(i)) continue;",
  "work(i);",
  "}",
  "after();",
  "}",
);

const COLLECTIONS = lines(
  "function f(xs, o) {",
  "before();",
  "for (const x of xs) {",
  "use(x);",
  "}",
  "for (const k in o) {",
  "use(k);",
  "}",
  "after();",
  "}",
);

const LABELLED = lines(
  "function f(rows) {",
  "prepare();",
  "outer: for (let i = 0; i < rows; i++) {",
  "for (let j = 0; j < i; j++) {",
  "if (bad(i, j)) continue outer;",
  "if (done(i, j)) break outer;",
  "cell(i, j);",
  "}",
  "}",
  "finish();",
  "}",
);

const NO_UPDATE = lines(
  "function f(c) {",
  "before();",
  "for (;;) {",
  "if (c()) continue;",
  "step();",
  "}",
  "}",
);

const FINALLY_CONTINUE = lines(
  "function f(n) {",
  "for (let i = 0; i < n; i++) {",
  "try {",
  "if (i === 3) continue;",
  "} finally {",
  "cleanup();",
  "}",
  "}",
  "}",
);

const THROWING_CLAUSES = lines(
  "function f(xs) {",
  "try {",
  "before();",
  "for (let i = start(); i < xs.length; i = next(i)) {",
  "work();",
  "}",
  "while (poll()) {",
  "drain();",
  "}",
  "} catch (error) {",
  "handle(error);",
  "}",
  "}",
);

const PURE_CLAUSES = lines(
  "function f(n) {",
  "try {",
  "before();",
  "for (let i = 0; i < n; i++) {",
  "work();",
  "}",
  "} catch (error) {",
  "handle(error);",
  "}",
  "}",
);

const DO_WHILE = lines(
  "function f(c) {",
  "before();",
  "do {",
  "body();",
  "} while (c);",
  "after();",
  "}",
);

describe("F-003 loop header isolation", () => {
  test("audit reproduction: a while loop does not absorb the statement before it", async () => {
    const graph = await graphOf("function f(c){ before(); while(c){ body(); } after(); }");
    const before = at(graph, "ExpressionStatement", 1, 15);
    const header = at(graph, "WhileStatement", 1, 25);

    expect(types(before)).toEqual(["ExpressionStatement"]);
    expect(types(header)).toEqual(["WhileStatement"]);
    expect(before.id).toBe(graph.entryBlockId);
    expect(incoming(graph, graph.entryBlockId)).toEqual([]);
    expect(loopsContaining(graph, before)).toEqual([]);
    expectLoopStructure(graph);
  });

  test("while: the loop-back edge targets a header holding only the loop test", async () => {
    const graph = await graphOf(WHILE);
    const before = at(graph, "ExpressionStatement", 2);
    const header = at(graph, "WhileStatement", 3);
    const body = at(graph, "ExpressionStatement", 4);
    const after = at(graph, "ExpressionStatement", 6);

    expect(types(header)).toEqual(["WhileStatement"]);
    expect(before.id).toBe(graph.entryBlockId);
    expect(outgoing(graph, before)).toEqual([{ toBlockId: header.id, kind: "next" }]);
    expect(graph.edges.filter((edge) => edge.kind === "loop-back").map(({ fromBlockId, toBlockId }) => ({ fromBlockId, toBlockId })))
      .toEqual([{ fromBlockId: body.id, toBlockId: header.id }]);
    expect(graph.loops).toEqual([{ headerBlockId: header.id, blockIds: [header.id, body.id].sort() }]);
    expect(loopsContaining(graph, before)).toEqual([]);
    expect(loopsContaining(graph, after)).toEqual([]);
    expect(immediateDominator(graph, header)).toBe(before.id);
    expect(successor(graph, header, "false").id).toBe(after.id);
    expectLoopStructure(graph);
  });

  test("for: init runs once before the header and continue runs the update", async () => {
    const graph = await graphOf(FOR);
    const before = at(graph, "ExpressionStatement", 2);
    const init = at(graph, "VariableDeclaration", 3);
    const header = at(graph, "ForStatement", 3);
    const update = at(graph, "UpdateExpression", 3);
    const guard = at(graph, "IfStatement", 4);
    const continued = at(graph, "ContinueStatement", 4);
    const work = at(graph, "ExpressionStatement", 5);
    const after = at(graph, "ExpressionStatement", 7);

    expect(types(header)).toEqual(["ForStatement"]);
    expect(types(update)).toEqual(["UpdateExpression"]);
    expect(init.id).toBe(before.id);
    expect(types(init)).toEqual(["ExpressionStatement", "VariableDeclaration"]);
    expect(loopsContaining(graph, init)).toEqual([]);
    expect(loopsContaining(graph, after)).toEqual([]);
    expect(loopsContaining(graph, update)).toEqual([header.id]);
    expect(update.id).not.toBe(header.id);

    expect(outgoing(graph, init)).toEqual([{ toBlockId: header.id, kind: "next" }]);
    expect(outgoing(graph, continued)).toEqual([{ toBlockId: update.id, kind: "continue" }]);
    expect(outgoing(graph, work)).toEqual([{ toBlockId: update.id, kind: "next" }]);
    expect(outgoing(graph, update)).toEqual([{ toBlockId: header.id, kind: "loop-back" }]);
    expect(incoming(graph, header.id).map((edge) => edge.fromBlockId).sort()).toEqual([init.id, update.id].sort());

    const loop = loopOf(graph, header);
    for (const member of [header, guard, continued, work, update]) expect(loop.blockIds).toContain(member.id);
    expect(loop.blockIds).not.toContain(init.id);
    expect(loop.blockIds).not.toContain(after.id);
    expect(immediateDominator(graph, header)).toBe(init.id);
    expectLoopStructure(graph);
  });

  test("for without an update: continue and normal completion return to the header", async () => {
    const graph = await graphOf(NO_UPDATE);
    const before = at(graph, "ExpressionStatement", 2);
    const header = at(graph, "ForStatement", 3);
    const continued = at(graph, "ContinueStatement", 4);
    const step = at(graph, "ExpressionStatement", 5);

    expect(types(header)).toEqual(["ForStatement"]);
    expect(outgoing(graph, continued)).toEqual([{ toBlockId: header.id, kind: "continue" }]);
    expect(outgoing(graph, step)).toEqual([{ toBlockId: header.id, kind: "loop-back" }]);
    expect(loopsContaining(graph, before)).toEqual([]);
    expect(graph.blocks.flatMap((block) => block.statements).some((node) => node.type === "UpdateExpression")).toBe(false);
    expectLoopStructure(graph);
  });

  test.each([
    ["while", "WhileStatement", "f@", lines("function f(c) {", "while (c) {", "step();", "}", "}")],
    ["for", "ForStatement", "f@", lines("function f(n) {", "for (let i = 0; i < n; i++) {", "step();", "}", "}")],
    ["for-of", "ForOfStatement", "f@", lines("function f(xs) {", "for (const x of xs) {", "step(x);", "}", "}")],
    ["for-in", "ForInStatement", "f@", lines("function f(o) {", "for (const k in o) {", "step(k);", "}", "}")],
    ["module while", "WhileStatement", "module", lines("while (c) {", "step();", "}")],
  ])("a leading %s loop leaves the entry block outside the loop", async (_name, type, scope, source) => {
    const graph = await graphOf(source, scope);
    const line = scope === "module" ? 1 : 2;
    const header = at(graph, type, line);
    const entry = blockById(graph, graph.entryBlockId);

    expect(types(header)).toEqual([type]);
    expect(header.id).not.toBe(entry.id);
    expect(outgoing(graph, entry)).toEqual([{ toBlockId: header.id, kind: "next" }]);
    expect(loopsContaining(graph, entry)).toEqual([]);
    expect(loopsContaining(graph, header)).toEqual([header.id]);
    expectLoopStructure(graph);
  });

  test("for-of and for-in: the iterated expression is evaluated once before the header", async () => {
    const graph = await graphOf(COLLECTIONS);
    const before = at(graph, "ExpressionStatement", 2);
    const items = at(graph, "Identifier", 3, 16);
    const ofHeader = at(graph, "ForOfStatement", 3);
    const object = at(graph, "Identifier", 6, 16);
    const inHeader = at(graph, "ForInStatement", 6);
    const after = at(graph, "ExpressionStatement", 9);

    expect(items.id).toBe(before.id);
    expect(types(ofHeader)).toEqual(["ForOfStatement"]);
    expect(types(inHeader)).toEqual(["ForInStatement"]);
    expect(successor(graph, ofHeader, "false").id).toBe(object.id);
    expect(outgoing(graph, object)).toEqual([{ toBlockId: inHeader.id, kind: "next" }]);
    expect(successor(graph, inHeader, "false").id).toBe(after.id);
    for (const once of [before, items, object, after]) expect(loopsContaining(graph, once)).toEqual([]);
    expect(loopsContaining(graph, ofHeader)).toEqual([ofHeader.id]);
    expect(loopsContaining(graph, inHeader)).toEqual([inHeader.id]);
    expectLoopStructure(graph);
  });

  test("labelled continue/break and nested loops target the right update, header and exit", async () => {
    const graph = await graphOf(LABELLED);
    const prepare = at(graph, "ExpressionStatement", 2);
    const label = at(graph, "LabeledStatement", 3);
    const outerInit = at(graph, "VariableDeclaration", 3);
    const outerHeader = at(graph, "ForStatement", 3);
    const outerUpdate = at(graph, "UpdateExpression", 3);
    const innerInit = at(graph, "VariableDeclaration", 4);
    const innerHeader = at(graph, "ForStatement", 4);
    const innerUpdate = at(graph, "UpdateExpression", 4);
    const continued = at(graph, "ContinueStatement", 5);
    const broken = at(graph, "BreakStatement", 6);
    const cell = at(graph, "ExpressionStatement", 7);
    const finish = at(graph, "ExpressionStatement", 10);

    expect(label.id).toBe(prepare.id);
    expect(outerInit.id).toBe(prepare.id);
    expect(types(outerHeader)).toEqual(["ForStatement"]);
    expect(types(innerHeader)).toEqual(["ForStatement"]);
    expect(outgoing(graph, continued)).toEqual([{ toBlockId: outerUpdate.id, kind: "continue" }]);
    expect(outgoing(graph, broken)).toEqual([{ toBlockId: finish.id, kind: "break" }]);
    expect(outgoing(graph, cell)).toEqual([{ toBlockId: innerUpdate.id, kind: "next" }]);
    expect(outgoing(graph, innerUpdate)).toEqual([{ toBlockId: innerHeader.id, kind: "loop-back" }]);
    expect(outgoing(graph, outerUpdate)).toEqual([{ toBlockId: outerHeader.id, kind: "loop-back" }]);
    expect(outgoing(graph, successor(graph, innerHeader, "false"))).toEqual([{ toBlockId: outerUpdate.id, kind: "next" }]);
    expect(successor(graph, outerHeader, "false").id).toBe(finish.id);

    expect(loopsContaining(graph, prepare)).toEqual([]);
    expect(loopsContaining(graph, finish)).toEqual([]);
    // The inner init runs once per outer iteration, never once per inner iteration.
    expect(loopsContaining(graph, innerInit)).toEqual([outerHeader.id]);
    expect(loopsContaining(graph, outerUpdate)).toEqual([outerHeader.id]);
    expect(loopsContaining(graph, innerUpdate)).toEqual([innerHeader.id, outerHeader.id].sort());
    expect(loopsContaining(graph, cell)).toEqual([innerHeader.id, outerHeader.id].sort());
    const inner = loopOf(graph, innerHeader);
    for (const member of inner.blockIds) expect(loopOf(graph, outerHeader).blockIds).toContain(member);
    expectLoopStructure(graph);
  });

  test("continue through finally resumes at the for update", async () => {
    const graph = await graphOf(FINALLY_CONTINUE);
    const header = at(graph, "ForStatement", 2);
    const update = at(graph, "UpdateExpression", 2);
    const continued = at(graph, "ContinueStatement", 4);
    const cleanups = graph.blocks.filter((block) => block.statements.some((node) => node.type === "ExpressionStatement" && node.location?.line === 6));
    const finalizer = successor(graph, continued, "finally");

    expect(cleanups.map((block) => block.id)).toContain(finalizer.id);
    expect(outgoing(graph, finalizer)).toEqual([{ toBlockId: update.id, kind: "continue" }]);
    expect(outgoing(graph, update)).toEqual([{ toBlockId: header.id, kind: "loop-back" }]);
    expect(loopOf(graph, header).blockIds).toContain(finalizer.id);
    expect(graph.unreachableBlockIds).toEqual([]);
    expectLoopStructure(graph);
  });

  test("potential exceptions leave from the block that evaluates each loop clause", async () => {
    const graph = await graphOf(THROWING_CLAUSES);
    const init = at(graph, "VariableDeclaration", 4);
    const forHeader = at(graph, "ForStatement", 4);
    const update = at(graph, "AssignmentExpression", 4);
    const whileHeader = at(graph, "WhileStatement", 7);
    const handler = at(graph, "ExpressionStatement", 11);
    const exception: { toBlockId: string; kind: ControlFlowEdgeKind } = { toBlockId: handler.id, kind: "exception" };

    expect(at(graph, "ExpressionStatement", 3).id).toBe(init.id);
    expect(types(forHeader)).toEqual(["ForStatement"]);
    expect(types(update)).toEqual(["AssignmentExpression"]);
    expect(types(whileHeader)).toEqual(["WhileStatement"]);
    expect(outgoing(graph, init)).toContainEqual(exception);
    expect(outgoing(graph, forHeader)).toContainEqual(exception);
    expect(outgoing(graph, update)).toEqual([exception, { toBlockId: forHeader.id, kind: "loop-back" }]);
    expect(outgoing(graph, whileHeader)).toContainEqual(exception);
    expectLoopStructure(graph);
  });

  test("non-throwing loop clauses add no exception edges", async () => {
    const graph = await graphOf(PURE_CLAUSES);
    const init = at(graph, "VariableDeclaration", 4);
    const header = at(graph, "ForStatement", 4);
    const update = at(graph, "UpdateExpression", 4);
    const handler = at(graph, "ExpressionStatement", 8);

    expect(outgoing(graph, header).map((edge) => edge.kind).sort()).toEqual(["false", "true"]);
    expect(outgoing(graph, update)).toEqual([{ toBlockId: header.id, kind: "loop-back" }]);
    // before() may throw; the pure init and test add nothing of their own.
    expect(outgoing(graph, init)).toEqual([{ toBlockId: handler.id, kind: "exception" }, { toBlockId: header.id, kind: "next" }]);
    expectLoopStructure(graph);
  });

  test("control: do-while already enters a fresh body header", async () => {
    const graph = await graphOf(DO_WHILE);
    const before = at(graph, "ExpressionStatement", 2);
    const body = at(graph, "ExpressionStatement", 4);
    const after = at(graph, "ExpressionStatement", 6);

    expect(types(before)).toEqual(["ExpressionStatement", "DoWhileStatement"]);
    expect(outgoing(graph, before)).toEqual([{ toBlockId: body.id, kind: "next" }]);
    expect(graph.loops.map((loop) => loop.headerBlockId)).toEqual([body.id]);
    expect(loopsContaining(graph, before)).toEqual([]);
    expect(loopsContaining(graph, after)).toEqual([]);
    expect(incoming(graph, graph.entryBlockId)).toEqual([]);
  });

  test("determinism: fresh and reused builders emit identical graphs", async () => {
    const reused = new DeterministicControlFlowGraphBuilder();
    for (const source of [WHILE, FOR, COLLECTIONS, LABELLED, NO_UPDATE, FINALLY_CONTINUE, THROWING_CLAUSES, PURE_CLAUSES, DO_WHILE]) {
      const ast = await parse(source);
      const digests = new Set<string>();
      for (let run = 0; run < 3; run++) {
        for (const builder of [new DeterministicControlFlowGraphBuilder(), reused]) {
          const graphs = builder.buildAll(ast);
          for (const graph of graphs) expectLoopStructure(graph);
          digests.add(createHash("sha256").update(JSON.stringify(graphs)).digest("hex"));
        }
      }
      expect(digests.size).toBe(1);
    }
  });
});
