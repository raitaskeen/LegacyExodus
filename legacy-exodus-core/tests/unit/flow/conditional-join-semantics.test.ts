import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { DeterministicDataFlowGraphBuilder, DeterministicFlowAnalysisEngine } from "@flow/index";
import { JavaScriptParser } from "@parser/index";

const filePath = "src/conditional-join.js";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
async function analyze(marked: string) {
  const positions = new Map<string, string>();
  let source = "", cursor = 0;
  for (const match of marked.matchAll(/\[\[(\w+)\]\]/g)) {
    source += marked.slice(cursor, match.index);
    const lines = source.split("\n");
    positions.set(match[1]!, `${lines.length}:${lines.at(-1)!.length}`);
    cursor = match.index! + match[0].length;
  }
  source += marked.slice(cursor);
  const position = (marker: string) => {
    const value = positions.get(marker);
    if (value === undefined) throw Error(`Missing marker ${marker}`);
    return value;
  };
  const ast = (await new JavaScriptParser().parse({ file: { id: "conditional-join", path: filePath, language: "javascript", size: source.length }, source })).result;
  expect(ast.errors).toEqual([]);
  const before = JSON.stringify(ast);
  const builder = new DeterministicDataFlowGraphBuilder();
  const result = builder.buildContext(ast);
  expect(JSON.stringify(ast)).toBe(before);
  expect(builder.computeTaintFlows(result.state, result.state.taintPaths)).toEqual(result.graph.taintFlows);
  expect(new DeterministicFlowAnalysisEngine().connect([], [result]).dataFlowGraphs[0]?.taintFlows).toEqual(result.graph.taintFlows);
  return { ...result, ast, builder, position };
}
type Result = Awaited<ReturnType<typeof analyze>>;
function definition(r: Result, marker: string, kind: "declaration" | "assignment" = "assignment", name = "x") {
  const id = hash(`definition:${filePath}:${name}:${kind}:${r.position(marker)}`);
  expect(r.graph.definitions.find((d) => d.id === id)).toMatchObject({ id, name, kind });
  return id;
}
function use(r: Result, marker: string, expected: string, name = "x") {
  const id = hash(`use:${filePath}:${name}:${r.position(marker)}`);
  expect(r.graph.uses.find((u) => u.id === id)?.definitionId).toBe(expected);
  expect(r.graph.defUseChains.find((c) => c.definitionId === expected)?.useIds).toContain(id);
  expect(r.graph.lifetimes.find((l) => l.declarationId === expected)?.useIds).toContain(id);
  for (const chain of r.graph.defUseChains.filter((c) => c.definitionId !== expected)) expect(chain.useIds).not.toContain(id);
}
function join(r: Result, marker: string, incoming: (string | undefined)[], depth = 0, name = "x") {
  const id = hash(`join:${filePath}:${name}:${r.position(marker)}:${depth}:${incoming.map((i) => i ?? "unbound").join(":")}`);
  expect(r.graph.definitions.find((d) => d.id === id)).toEqual({ id, filePath, name, kind: "assignment" });
  expect(r.state.transfers.filter((t) => t.targetDefinitionId === id).map((t) => t.sourceDefinitionId).sort())
    .toEqual([...new Set(incoming.filter((i): i is string => i !== undefined))].sort());
  return id;
}
function sink(r: Result, target: string, sources: [string, string, "CONFIRMED" | "INFERRED"][]) {
  use(r, "K", target);
  expect(r.state.sinks).toHaveLength(1);
  expect(r.state.sinks[0]?.argumentDefinitionIds).toEqual([target]);
  expect(r.graph.taintFlows.map((f) => [f.sourceId, f.state]).sort())
    .toEqual(sources.map(([marker, path, state]) => [hash(`source:${filePath}:${path}:${r.position(marker)}`), state]).sort());
  for (const flow of r.graph.taintFlows) {
    expect(flow.path.at(-2)).toBe(target);
    expect(flow.sinkId).toBe(r.state.sinks[0]!.id);
  }
}

describe("F02-B transactional If convergence", () => {
  test("unconditional outer write stays CONFIRMED without a join", async () => {
    const r = await analyze('let [[D]]x = "safe"; { [[A]]x = [[S]]req.query.x; } child_process.exec([[K]]x);');
    sink(r, definition(r, "A"), [["S", "req.query.x", "CONFIRMED"]]);
    expect(r.graph.definitions).toHaveLength(2);
  });
  test("conditional taint introduction joins entry and branch", async () => {
    const r = await analyze('let [[D]]x = "safe"; [[J]]if (c) { [[A]]x = [[S]]req.query.x; } child_process.exec([[K]]x);');
    sink(r, join(r, "J", [definition(r, "A"), definition(r, "D", "declaration")]), [["S", "req.query.x", "INFERRED"]]);
  });
  for (const value of ['"safe"', 'sanitize([[R]]x)', 'validator.escape([[R]]x)']) {
    test(`conditional ${value} preserves unsanitized fall-through`, async () => {
      const r = await analyze(`let [[D]]x = [[S]]req.query.x; [[J]]if (c) [[A]]x = ${value}; child_process.exec([[K]]x);`);
      const d = definition(r, "D", "declaration"), a = definition(r, "A");
      if (value.includes("[[R]]")) use(r, "R", d);
      expect(r.state.transfers.filter((t) => t.targetDefinitionId === a)).toEqual([]);
      sink(r, join(r, "J", [a, d]), [["S", "req.query.x", "INFERRED"]]);
    });
  }
  test("tainted then and clean else join without overwriting entry reads", async () => {
    const r = await analyze('let [[D]]x = "safe"; [[J]]if (c) { [[A]]x = [[S]]req.query.x; } else { use([[R]]x); [[B]]x = "clean"; } child_process.exec([[K]]x);');
    use(r, "R", definition(r, "D", "declaration"));
    sink(r, join(r, "J", [definition(r, "A"), definition(r, "B")]), [["S", "req.query.x", "INFERRED"]]);
  });
  test("different branch sources each remain INFERRED", async () => {
    const r = await analyze('let x; [[J]]if (c) [[A]]x = [[S]]req.query.x; else [[B]]x = [[T]]req.body.x; child_process.exec([[K]]x);');
    sink(r, join(r, "J", [definition(r, "A"), definition(r, "B")]), [["S", "req.query.x", "INFERRED"], ["T", "req.body.x", "INFERRED"]]);
  });
  test("both branches clean remove prior taint", async () => {
    const r = await analyze('let x = req.query.x; [[J]]if (c) [[A]]x = "a"; else [[B]]x = "b"; child_process.exec([[K]]x);');
    sink(r, join(r, "J", [definition(r, "A"), definition(r, "B")]), []);
  });
  test("same source reaches every incoming definition and stays CONFIRMED", async () => {
    const r = await analyze('let [[D]]x = [[S]]req.query.x; [[J]]if (c) [[A]]x = [[R]]x + 1; else [[B]]x = [[U]]x + 2; child_process.exec([[K]]x);');
    const d = definition(r, "D", "declaration"); use(r, "R", d); use(r, "U", d);
    sink(r, join(r, "J", [definition(r, "A"), definition(r, "B")]), [["S", "req.query.x", "CONFIRMED"]]);
  });
  test("nested joins preserve inner and outer alternatives", async () => {
    const r = await analyze('let [[D]]x = "safe"; [[J]]if (c) { [[I]]if (d) [[A]]x = [[S]]req.query.x; } child_process.exec([[K]]x);');
    const d = definition(r, "D", "declaration"), inner = join(r, "I", [definition(r, "A"), d], 1);
    sink(r, join(r, "J", [inner, d]), [["S", "req.query.x", "INFERRED"]]);
    expect(r.graph.taintFlows[0]?.path).toContain(inner);
  });
  test("inner partial join cannot be upgraded by an outer all-source join", async () => {
    const r = await analyze('let [[D]]x = [[S]]req.query.x; [[J]]if (c) { [[I]]if (d) [[A]]x = "safe"; } else [[B]]x = [[R]]x + 1; child_process.exec([[K]]x);');
    const d = definition(r, "D", "declaration"), inner = join(r, "I", [definition(r, "A"), d], 1);
    use(r, "R", d);
    sink(r, join(r, "J", [inner, definition(r, "B")]), [["S", "req.query.x", "INFERRED"]]);
  });
  test("lexical shadow produces no outer join", async () => {
    const r = await analyze('let [[D]]x = [[S]]req.query.x; if (c) { let [[I]]x = "safe"; x = "clean"; } child_process.exec([[K]]x);');
    sink(r, definition(r, "D", "declaration"), [["S", "req.query.x", "CONFIRMED"]]);
    expect(r.graph.definitions).toHaveLength(3);
  });
  test("unchanged alternatives do not synthesize joins", async () => {
    const r = await analyze('let [[D]]x = [[S]]req.query.x; if (c) use([[R]]x); else use([[U]]x); child_process.exec([[K]]x);');
    const d = definition(r, "D", "declaration"); use(r, "R", d); use(r, "U", d); sink(r, d, [["S", "req.query.x", "CONFIRMED"]]);
    expect(r.graph.definitions).toHaveLength(1);
  });
  test("conditional var joins an unbound fall-through", async () => {
    const r = await analyze('[[J]]if (c) { var [[D]]x = [[S]]req.query.x; } child_process.exec([[K]]x);');
    sink(r, join(r, "J", [definition(r, "D", "declaration"), undefined]), [["S", "req.query.x", "INFERRED"]]);
  });
  test("uncalled function branch writes do not replace ancestor state", async () => {
    const r = await analyze('let [[D]]x = [[S]]req.query.x; function f() { if (c) { x = "safe"; } } child_process.exec([[K]]x);');
    sink(r, definition(r, "D", "declaration"), [["S", "req.query.x", "CONFIRMED"]]);
  });
  test("conditional captured-binding sanitizer retains the ancestor fall-through locally", async () => {
    const r = await analyze('let [[D]]x = [[S]]req.query.x; function f() { [[J]]if (c) [[A]]x = sanitize([[R]]x); child_process.exec([[K]]x); } use([[U]]x);');
    const d = definition(r, "D", "declaration"); use(r, "R", d); use(r, "U", d);
    sink(r, join(r, "J", [definition(r, "A"), d], 1), [["S", "req.query.x", "INFERRED"]]);
  });
  test("certainty survives downstream assignment and an unconditional alternative", async () => {
    const r = await analyze('let [[D]]y = [[S]]req.query.x; let x = "safe"; if (c) x = y; let [[Z]]z = x; child_process.exec([[K]]z);');
    const z = definition(r, "Z", "declaration", "z");
    use(r, "K", z, "z");
    expect(r.graph.taintFlows.map((f) => f.state)).toEqual(["INFERRED"]);
    const certain = await analyze('let y = req.query.x; let x = "safe"; if (c) x = y; child_process.exec(x, y);');
    expect(certain.graph.taintFlows.map((f) => f.state)).toEqual(["CONFIRMED"]);
  });
  test("three repeated builds, reused builder, and AST remain stable", async () => {
    const r = await analyze('let x = req.query.x; if (c) x = sanitize(x); child_process.exec(x);');
    const ast = JSON.stringify(r.ast), hashes: string[] = [];
    for (let run = 0; run < 3; run++) {
      const next = r.builder.buildContext(r.ast);
      expect(next.graph).toEqual(r.graph);
      expect(next.state.transfers).toEqual(r.state.transfers);
      hashes.push(hash(JSON.stringify(next.graph)));
    }
    expect(new Set(hashes).size).toBe(1);
    const clean = await analyze('let x = "safe"; if (c) x = "clean"; child_process.exec(x);');
    expect(r.builder.build(clean.ast)).toEqual(clean.graph);
    expect(r.builder.computeTaintFlows(r.state, r.state.taintPaths)).toEqual(r.graph.taintFlows);
    expect(JSON.stringify(r.ast)).toBe(ast);
  });
});
