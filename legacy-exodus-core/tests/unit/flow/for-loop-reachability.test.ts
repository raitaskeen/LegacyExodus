import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { DeterministicControlFlowGraphBuilder } from "@flow/control-flow-builder";
import type { BasicBlock, ControlFlowGraph } from "@flow/flow-contracts";
import { JavaScriptParser, type ASTResult } from "@parser/index";

async function parse(body: string): Promise<ASTResult> {
  const source = `function f() {\n${body}\nafter();\n}`;
  const ast = (await new JavaScriptParser().parse({
    file: { id: "for-loop", path: "src/for-loop.js", language: "javascript", size: source.length }, source,
  })).result;
  expect(ast.errors).toEqual([]);
  return ast;
}

function graphFor(ast: ASTResult, builder = new DeterministicControlFlowGraphBuilder()): ControlFlowGraph {
  const before = JSON.stringify(ast);
  const graph = builder.buildAll(ast).find((item) => item.scopeName.startsWith("f@"));
  expect(JSON.stringify(ast)).toBe(before);
  if (graph === undefined) throw new Error("Missing function f CFG");
  expect(graph.state).toBe("RESOLVED");
  return graph;
}

function at(graph: ControlFlowGraph, type: string, line: number): BasicBlock {
  const matches = graph.blocks.filter((block) => block.statements.some(
    (node) => node.type === type && node.location?.line === line && node.location.column === 0,
  ));
  expect(matches).toHaveLength(1);
  const block = matches[0];
  if (block === undefined) throw new Error(`Missing ${type} at ${line}:0`);
  return block;
}

function reachable(graph: ControlFlowGraph, start = graph.entryBlockId): Set<string> {
  const seen = new Set<string>();
  const pending = [start];
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    for (const edge of graph.edges) if (edge.fromBlockId === id) pending.push(edge.toBlockId);
  }
  return seen;
}

function facts(graph: ControlFlowGraph, block: BasicBlock, expected: boolean): void {
  expect(reachable(graph).has(block.id)).toBe(expected);
  expect(graph.unreachableBlockIds.includes(block.id)).toBe(!expected);
  for (const node of block.statements) expect(graph.deadCodeNodeIds.includes(node.id)).toBe(!expected);
}

function outgoing(graph: ControlFlowGraph, block: BasicBlock) {
  return graph.edges.filter((edge) => edge.fromBlockId === block.id)
    .map(({ toBlockId, kind }) => ({ toBlockId, kind }));
}

interface Case {
  readonly id: string;
  readonly body: string;
  readonly after: boolean;
  readonly condition?: "true" | "false" | "dynamic";
  readonly type?: string;
  readonly headerLine?: number;
  readonly breaks?: readonly number[];
  readonly continues?: readonly number[];
  readonly abrupt?: "ReturnStatement" | "ThrowStatement";
  readonly deadBreak?: number;
  readonly innerBreak?: number;
  readonly finalizer?: "break" | "continue";
  readonly update?: boolean;
  readonly cycle?: boolean;
}

const cases: readonly Case[] = [
  { id: "T01 canonical omitted test", body: "for (;;) {}", after: false, cycle: true },
  { id: "T02 explicit true", body: "for (; true;) {}", after: false, cycle: true },
  { id: "T03 explicit false", body: "for (; false;) {}", after: true, condition: "false" },
  { id: "T04 dynamic condition", body: "for (; condition;) {\nbody();\n}", after: true, condition: "dynamic", cycle: true },
  { id: "T05 direct break", body: "for (;;) {\nbreak;\n}", after: true, breaks: [3] },
  { id: "T06 direct continue", body: "for (;;) {\ncontinue;\n}", after: false, continues: [3] },
  { id: "T07 direct return", body: "for (;;) {\nreturn 1;\n}", after: false, abrupt: "ReturnStatement" },
  { id: "T08 direct throw", body: "for (;;) {\nthrow error;\n}", after: false, abrupt: "ThrowStatement" },
  { id: "T09 conditional break", body: "for (;;) {\nif (c) {\nbreak;\n}\n}", after: true, breaks: [4] },
  { id: "T10 all-path continue", body: "for (;;) {\nif (c) {\ncontinue;\n} else {\ncontinue;\n}\n}", after: false, continues: [4, 6] },
  { id: "T11 break versus return", body: "for (;;) {\nif (c) {\nbreak;\n} else {\nreturn 1;\n}\n}", after: true, breaks: [4] },
  { id: "T12 unreachable break", body: "for (;;) {\ncontinue;\nbreak;\n}", after: false, continues: [3], deadBreak: 4 },
  { id: "T13 nested inner-loop break", body: "for (;;) {\nwhile (c) {\nbreak;\n}\n}", after: false, innerBreak: 4, cycle: true },
  { id: "T14 outer labeled break", body: "outer:\nfor (;;) {\nwhile (c) {\nbreak outer;\n}\n}", after: true, headerLine: 3, breaks: [5] },
  { id: "T15 EmptyStatement body", body: "for (;;);", after: false, cycle: true },
  { id: "T16 update clause", body: "for (let i = 0;; i++) {\nbody();\n}", after: false, update: true, cycle: true },
  { id: "T17 update and conditional break", body: "for (let i = 0;; i++) {\nif (c) {\nbreak;\n}\n}", after: true, update: true, breaks: [4] },
  { id: "T18 nested block break", body: "for (;;) {\n{\nbreak;\n}\n}", after: true, breaks: [4] },
  { id: "T19 nested block continue", body: "for (;;) {\n{\ncontinue;\n}\n}", after: false, continues: [4] },
  { id: "T20 try/finally break", body: "for (;;) {\ntry {\nbreak;\n} finally {\ncleanup();\n}\n}", after: true, finalizer: "break" },
  { id: "T21 try/finally continue", body: "for (;;) {\ntry {\ncontinue;\n} finally {\ncleanup();\n}\n}", after: false, finalizer: "continue" },
  { id: "T22 ForIn firewall", body: "for (const x in obj) {\nbody();\n}", after: true, condition: "dynamic", type: "ForInStatement", cycle: true },
  { id: "T23 ForOf firewall", body: "for (const x of xs) {\nbody();\n}", after: true, condition: "dynamic", type: "ForOfStatement", cycle: true },
];

describe("F03-B omitted for-test reachability", () => {
  for (const scenario of cases) test(scenario.id, async () => {
    const ast = await parse(scenario.body);
    const graph = graphFor(ast);
    const header = at(graph, scenario.type ?? "ForStatement", scenario.headerLine ?? 2);
    const after = at(graph, "ExpressionStatement", scenario.body.split("\n").length + 2);
    facts(graph, header, true);
    const edges = outgoing(graph, header);
    const yes = edges.filter((edge) => edge.kind === "true");
    const no = edges.filter((edge) => edge.kind === "false");
    expect(yes).toHaveLength(scenario.condition === "false" ? 0 : 1);
    expect(no).toEqual(scenario.condition === "false" || scenario.condition === "dynamic"
      ? [{ toBlockId: after.id, kind: "false" }] : []);
    facts(graph, after, scenario.after);
    if (scenario.cycle) {
      const entry = yes[0];
      if (entry === undefined) throw new Error("Missing body entry");
      expect(reachable(graph, entry.toBlockId).has(header.id)).toBe(true);
      expect(graph.edges.some((edge) => edge.toBlockId === header.id && edge.kind === "loop-back"
        && reachable(graph).has(edge.fromBlockId))).toBe(true);
    }
    for (const line of scenario.breaks ?? []) {
      const broken = at(graph, "BreakStatement", line);
      facts(graph, broken, true);
      expect(outgoing(graph, broken)).toEqual([{ toBlockId: after.id, kind: "break" }]);
      expect(graph.edges.filter((edge) => edge.toBlockId === after.id && reachable(graph).has(edge.fromBlockId))
        .map((edge) => edge.kind)).toEqual(["break"]);
    }
    for (const line of scenario.continues ?? []) {
      const continued = at(graph, "ContinueStatement", line);
      facts(graph, continued, true);
      expect(outgoing(graph, continued)).toEqual([{ toBlockId: header.id, kind: "continue" }]);
    }
    if (scenario.abrupt !== undefined) {
      const abrupt = at(graph, scenario.abrupt, 3);
      facts(graph, abrupt, true);
      expect(abrupt.terminator).toBe(scenario.abrupt);
      expect(outgoing(graph, abrupt)).toEqual([{ toBlockId: graph.exitBlockId,
        kind: scenario.abrupt === "ReturnStatement" ? "return" : "throw" }]);
    }
    if (scenario.id.startsWith("T11")) {
      const returned = at(graph, "ReturnStatement", 6);
      facts(graph, returned, true);
      expect(outgoing(graph, returned)).toEqual([{ toBlockId: graph.exitBlockId, kind: "return" }]);
    }
    if (scenario.deadBreak !== undefined) facts(graph, at(graph, "BreakStatement", scenario.deadBreak), false);
    if (scenario.innerBreak !== undefined) {
      const broken = at(graph, "BreakStatement", scenario.innerBreak);
      const inner = at(graph, "WhileStatement", 3);
      const innerExit = outgoing(graph, inner).find((edge) => edge.kind === "false");
      if (innerExit === undefined) throw new Error("Missing inner exit");
      expect(innerExit.toBlockId).not.toBe(after.id);
      expect(outgoing(graph, broken)).toEqual([{ toBlockId: innerExit.toBlockId, kind: "break" }]);
      expect(reachable(graph, innerExit.toBlockId).has(header.id)).toBe(true);
    }
    if (scenario.finalizer !== undefined) {
      const abrupt = at(graph, scenario.finalizer === "break" ? "BreakStatement" : "ContinueStatement", 4);
      const cleanup = at(graph, "ExpressionStatement", 6);
      facts(graph, abrupt, true);
      facts(graph, cleanup, true);
      expect(outgoing(graph, abrupt)).toEqual([{ toBlockId: cleanup.id, kind: "finally" }]);
      expect(outgoing(graph, cleanup)).toEqual([{ toBlockId: scenario.finalizer === "break" ? after.id : header.id,
        kind: scenario.finalizer }]);
    }
    if (scenario.update) {
      const nodes = [ast.root];
      for (let index = 0; index < nodes.length; index++) {
        const node = nodes[index];
        if (node !== undefined) nodes.push(...node.children);
      }
      const loop = nodes.find((node) => node.type === "ForStatement");
      expect(loop?.children.find((node) => node.role === "init")?.type).toBe("VariableDeclaration");
      expect(loop?.children.find((node) => node.role === "update")?.type).toBe("UpdateExpression");
      // F-003: the init runs once in the pre-loop block; the update has its own block that loops back to the header.
      expect(header.statements.map((node) => node.type)).toEqual(["ForStatement"]);
      const holding = (type: string) => graph.blocks.filter((block) => block.statements.some((node) => node.type === type));
      expect(holding("VariableDeclaration").map((block) => block.id)).toEqual([graph.entryBlockId]);
      expect(graph.loops.some((loop) => loop.blockIds.includes(graph.entryBlockId))).toBe(false);
      const updates = holding("UpdateExpression");
      expect(updates).toHaveLength(1);
      const update = updates[0];
      if (update === undefined) throw new Error("Missing update block");
      facts(graph, update, true);
      expect(update.statements.map((node) => node.type)).toEqual(["UpdateExpression"]);
      expect(outgoing(graph, update)).toEqual([{ toBlockId: header.id, kind: "loop-back" }]);
      expect(graph.loops.find((loop) => loop.headerBlockId === header.id)?.blockIds).toContain(update.id);
    }
    if (scenario.id.startsWith("T18") || scenario.id.startsWith("T19")) {
      expect(graph.blocks.flatMap((block) => block.statements).some((node) => node.type === "BlockStatement")).toBe(false);
    }
  });

  test("T24 fresh/reused determinism and AST immutability", async () => {
    const corpus = [cases[0], cases[4], cases[5], cases[15], cases[21], cases[22]];
    const reused = new DeterministicControlFlowGraphBuilder();
    for (const scenario of corpus) {
      if (scenario === undefined) throw new Error("Missing determinism case");
      const ast = await parse(scenario.body);
      const baseline = JSON.stringify(graphFor(ast));
      const hashes: string[] = [];
      for (let run = 0; run < 3; run++) {
        for (const builder of [new DeterministicControlFlowGraphBuilder(), reused]) {
          const serialized = JSON.stringify(graphFor(ast, builder));
          expect(serialized).toBe(baseline);
          hashes.push(createHash("sha256").update(serialized).digest("hex"));
        }
      }
      expect(new Set(hashes).size).toBe(1);
      console.log(`${scenario.id}: ${hashes[0]} (3 fresh + 3 reused)`);
    }
  });

  test.each([
    ["ForInStatement", "for (const x in obj) {}"],
    ["ForOfStatement", "for (const x of xs) {}"],
    ["WhileStatement", "while (true) {}"],
    ["DoWhileStatement", "do {} while (true);"],
  ])("unchanged topology firewall %s", async (type, body) => {
    const graph = graphFor(await parse(body));
    const header = at(graph, type, 2);
    const after = at(graph, "ExpressionStatement", 3);
    const collection = type === "ForInStatement" || type === "ForOfStatement";
    facts(graph, after, collection);
    if (collection) {
      expect(outgoing(graph, header).filter((edge) => edge.kind === "true")).toHaveLength(1);
      expect(outgoing(graph, header).filter((edge) => edge.kind === "false"))
        .toEqual([{ toBlockId: after.id, kind: "false" }]);
    }
    console.log(`${type} topology: ${createHash("sha256").update(JSON.stringify(graph)).digest("hex")}`);
  });
});
