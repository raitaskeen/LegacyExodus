import { describe, expect, test } from "bun:test";

import { DeterministicDataFlowGraphBuilder, type DataFlowGraph, type VariableDefinition } from "@flow/index";
import { JavaScriptParser } from "@parser/index";

async function analyze(source: string): Promise<DataFlowGraph> {
  const ast = (await new JavaScriptParser().parse({
    file: { id: "assignment-transfer", path: "src/assignment-transfer.js", language: "javascript", size: source.length },
    source,
  })).result;
  expect(ast.errors).toEqual([]);
  return new DeterministicDataFlowGraphBuilder().build(ast);
}

function definition(graph: DataFlowGraph, name: string, kind: VariableDefinition["kind"]): VariableDefinition {
  const matches = graph.definitions.filter((item) => item.name === name && item.kind === kind);
  expect(matches).toHaveLength(1);
  const result = matches[0];
  if (result === undefined) throw new Error(`Missing ${kind} of ${name}`);
  return result;
}

function expectPath(graph: DataFlowGraph, definitions: readonly VariableDefinition[]): void {
  expect(graph.taintFlows).toHaveLength(1);
  const flow = graph.taintFlows[0];
  if (flow === undefined) throw new Error("Missing source-to-sink flow");
  expect(flow.path).toEqual([flow.sourceId, ...definitions.map((item) => item.id), "child_process.exec"]);
  expect(flow.state).toBe("CONFIRMED");
  expect(new Set(flow.path).size).toBe(flow.path.length);
}

function expectUses(graph: DataFlowGraph, name: string, expected: readonly VariableDefinition[]): void {
  expect(graph.uses.filter((use) => use.name === name).map((use) => use.definitionId).sort())
    .toEqual(expected.map((item) => item.id).sort());
}

describe("F01: assignment reads precede binding replacement", () => {
  test("baseline source reaches the sink through its original definition", async () => {
    const graph = await analyze("let x = req.query.x; child_process.exec(x);");
    const initial = definition(graph, "x", "declaration");
    expectPath(graph, [initial]);
    expectUses(graph, "x", [initial]);
  });

  test("self-assignment reads the old definition and the sink reads the new definition", async () => {
    const graph = await analyze("let x = req.query.x; x = x + 1; child_process.exec(x);");
    const initial = definition(graph, "x", "declaration");
    const updated = definition(graph, "x", "assignment");
    expectUses(graph, "x", [initial, updated]);
    expectPath(graph, [initial, updated]);
    expect(graph.defUseChains.filter((chain) => chain.definitionId === initial.id).map((chain) => chain.useIds))
      .toEqual([graph.uses.filter((use) => use.name === "x" && use.definitionId === initial.id).map((use) => use.id)]);
  });

  test("repeated self-updates retain an ordered acyclic path", async () => {
    const firstUpdate = definition(await analyze("let x = req.query.x; x = x + 1;"), "x", "assignment");
    const graph = await analyze("let x = req.query.x; x = x + 1; x = x + 2; child_process.exec(x);");
    const initial = definition(graph, "x", "declaration");
    const updates = graph.definitions.filter((item) => item.name === "x" && item.kind === "assignment");
    expect(updates).toHaveLength(2);
    expectUses(graph, "x", [initial, ...updates]);
    const secondUpdate = updates.find((item) => item.id !== firstUpdate.id);
    if (secondUpdate === undefined) throw new Error("Missing second assignment");
    expectPath(graph, [initial, firstUpdate, secondUpdate]);
  });

  for (const expression of ["x = x + 1", "x = unknownFunction(x)", "[x] = [x]", "({ x } = { x })", "x = ((x + 1) * (x + 2))"]) {
    test(`preserves incoming flow for ${expression}`, async () => {
      const graph = await analyze(`let x = req.query.x; ${expression}; child_process.exec(x);`);
      expectPath(graph, [definition(graph, "x", "declaration"), definition(graph, "x", "assignment")]);
    });
  }

  for (const operator of ["+=", "-=", "*=", "/=", "%=", "**=", "<<=", ">>=", ">>>=", "&=", "|=", "^="]) {
    test(`${operator} reads the incoming LHS and does not report the RHS as a constant result`, async () => {
      const graph = await analyze(`let x = req.query.x; x ${operator} 2; child_process.exec(x);`);
      const initial = definition(graph, "x", "declaration");
      const updated = definition(graph, "x", "assignment");
      expectUses(graph, "x", [initial, updated]);
      expectPath(graph, [initial, updated]);
      expect(updated.constantValue).toBeUndefined();
    });
  }

  test("compound assignment also transfers its RHS dependency", async () => {
    const graph = await analyze("let x = 1; const y = req.query.x; x += y; child_process.exec(x);");
    expectPath(graph, [definition(graph, "y", "declaration"), definition(graph, "x", "assignment")]);
    expectUses(graph, "y", [definition(graph, "y", "declaration")]);
  });

  test("ordinary assignment and a chained use preserve the right definitions", async () => {
    const graph = await analyze("let x = req.query.x; let y; x = x + 1; y = x; child_process.exec(y);");
    const initial = definition(graph, "x", "declaration");
    const updated = definition(graph, "x", "assignment");
    const copied = definition(graph, "y", "assignment");
    expectPath(graph, [initial, updated, copied]);
    expectUses(graph, "x", [initial, updated]);
    expectUses(graph, "y", [copied]);
  });

  for (const expression of ['x = "safe"', "x = sanitize(x)", "x = validator.escape(x)", '[x] = ["safe"]', '({ x } = { x: "safe" })']) {
    test(`${expression} does not retain stale taint`, async () => {
      const graph = await analyze(`let x = req.query.x; ${expression}; child_process.exec(x);`);
      const initial = definition(graph, "x", "declaration");
      const updated = definition(graph, "x", "assignment");
      // XA-01: a sanitizer's result still carries the source, so the command sees it through the new binding only.
      if (expression.includes("(x)")) {
        expect(graph.taintFlows).toHaveLength(1);
        expect(graph.taintFlows[0]?.path.at(-2)).toBe(updated.id);
      } else expect(graph.taintFlows).toEqual([]);
      expectUses(graph, "x", expression.includes("(x)") ? [initial, updated] : [updated]);
    });
  }

  test("clean self-update records the old read without fabricating taint", async () => {
    const graph = await analyze("let x = 1; x = x + 1; child_process.exec(x);");
    expect(graph.taintFlows).toEqual([]);
    expectUses(graph, "x", [definition(graph, "x", "declaration"), definition(graph, "x", "assignment")]);
  });

  test("an unrelated clean sink is not tainted by a self-update", async () => {
    const graph = await analyze('let x = req.query.x; x = x + 1; const safe = "safe"; child_process.exec(safe);');
    expect(graph.taintFlows).toEqual([]);
    expectUses(graph, "x", [definition(graph, "x", "declaration")]);
    expectUses(graph, "safe", [definition(graph, "safe", "declaration")]);
  });

  test("destructuring evaluates both RHS values before publishing either target", async () => {
    const graph = await analyze('let x = req.query.x; let y = "safe"; [x, y] = [y, x]; child_process.exec(y); child_process.exec(x);');
    expectPath(graph, [definition(graph, "x", "declaration"), definition(graph, "y", "assignment")]);
    expectUses(graph, "x", [definition(graph, "x", "declaration"), definition(graph, "x", "assignment")]);
    expectUses(graph, "y", [definition(graph, "y", "declaration"), definition(graph, "y", "assignment")]);
  });

  test("a supported local return passes the incoming argument into the new receiver", async () => {
    const graph = await analyze("function identity(value) { return value; } let x = req.query.x; x = identity(x); child_process.exec(x);");
    expectUses(graph, "x", [definition(graph, "x", "declaration"), definition(graph, "x", "assignment")]);
    expectPath(graph, [definition(graph, "x", "declaration"), definition(graph, "value", "parameter"), definition(graph, "identity:return", "return"), definition(graph, "x", "assignment")]);
  });

  test("corrected graphs are identical across repeated analyses", async () => {
    const source = "let x = req.query.x; x = x + 1; x *= 2; child_process.exec(x);";
    const first = await analyze(source);
    expect(await analyze(source)).toEqual(first);
    expect(await analyze(source)).toEqual(first);
  });

  test("a nested overwrite does not restore the incoming taint", async () => {
    const graph = await analyze('let x = req.query.x; x = (x = "safe"); child_process.exec(x);');
    expect(graph.taintFlows).toEqual([]);
  });

  test("a sequence reads the value after its nested overwrite", async () => {
    const graph = await analyze('let x = req.query.x; x = (x = "safe", x); child_process.exec(x);');
    expect(graph.taintFlows).toEqual([]);
  });
});
