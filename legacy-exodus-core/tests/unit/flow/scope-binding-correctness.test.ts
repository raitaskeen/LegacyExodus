import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { DeterministicDataFlowGraphBuilder, type VariableDefinition } from "@flow/index";
import { JavaScriptParser } from "@parser/index";

const filePath = "src/scope-binding.js";
function fixture(marked: string) {
  const positions = new Map<string, string>();
  let source = "";
  let cursor = 0;
  for (const match of marked.matchAll(/\[\[(\w+)\]\]/g)) {
    source += marked.slice(cursor, match.index);
    const lines = source.split("\n");
    positions.set(match[1]!, `${lines.length}:${lines.at(-1)!.length}`);
    cursor = match.index! + match[0].length;
  }
  source += marked.slice(cursor);
  const id = (marker: string, name: string, kind?: VariableDefinition["kind"]) => {
    const position = positions.get(marker);
    if (position === undefined) throw new Error(`Missing marker ${marker}`);
    return createHash("sha256").update(kind === undefined
      ? `use:${filePath}:${name}:${position}`
      : `definition:${filePath}:${name}:${kind}:${position}`).digest("hex");
  };
  return { source, id };
}
async function analyze(marked: string) {
  const input = fixture(marked);
  const ast = (await new JavaScriptParser().parse({ file: { id: "f02", path: filePath, language: "javascript", size: input.source.length }, source: input.source })).result;
  expect(ast.errors).toEqual([]);
  const before = JSON.stringify(ast);
  const builder = new DeterministicDataFlowGraphBuilder();
  const result = builder.buildContext(ast);
  expect(JSON.stringify(ast)).toBe(before);
  return { ...input, ...result, ast, builder };
}
type Result = Awaited<ReturnType<typeof analyze>>;
function definition(result: Result, marker: string, name = "x", kind: VariableDefinition["kind"] = "declaration") {
  const id = result.id(marker, name, kind);
  expect(result.graph.definitions.find((item) => item.id === id)).toMatchObject({ id, name, kind });
  return id;
}
function use(result: Result, marker: string, expected: string | undefined, name = "x") {
  const id = result.id(marker, name);
  const actual = result.graph.uses.find((item) => item.id === id);
  expect(actual).toBeDefined();
  expect(actual?.definitionId).toBe(expected);
  if (expected !== undefined) {
    expect(result.graph.defUseChains.find((chain) => chain.definitionId === expected)?.useIds).toContain(id);
    for (const chain of result.graph.defUseChains.filter((chain) => chain.definitionId !== expected)) expect(chain.useIds).not.toContain(id);
  }
}
function sink(result: Result, expected: string, tainted: boolean, path?: string[]) {
  expect(result.state.sinks).toHaveLength(1);
  expect(result.state.sinks[0]?.argumentDefinitionIds).toEqual([expected]);
  expect(result.graph.taintFlows).toHaveLength(tainted ? 1 : 0);
  if (tainted) {
    const flow = result.graph.taintFlows[0]!;
    expect(flow.sinkId).toBe(result.state.sinks[0]!.id);
    expect(flow.path.at(-2)).toBe(expected);
    expect(flow.state).toBe("CONFIRMED");
    if (path !== undefined) expect(flow.path).toEqual([flow.sourceId, ...path, "child_process.exec"]);
  }
}
function transfer(result: Result, from: string, to: string) {
  expect(result.state.transfers).toContainEqual({ sourceDefinitionId: from, targetDefinitionId: to });
}

describe("F02 binding ownership", () => {
  for (const kind of ["let", "const"]) {
    test(`block ${kind} does not leak`, async () => {
      const r = await analyze(`{ ${kind} [[D]]x = req.query.x; use([[I]]x); } child_process.exec([[K]]x);`);
      use(r, "I", definition(r, "D"));
      use(r, "K", undefined);
      expect(r.state.sinks[0]?.argumentDefinitionIds).toEqual([]);
      expect(r.graph.taintFlows).toEqual([]);
    });
    test(`inner ${kind} shadows outer lexical binding`, async () => {
      const r = await analyze(`let [[O]]x = "safe"; { ${kind} [[I]]x = req.query.x; use([[U]]x); } child_process.exec([[K]]x);`);
      use(r, "U", definition(r, "I"));
      const outer = definition(r, "O");
      use(r, "K", outer);
      sink(r, outer, false);
    });
  }
  for (const [name, prefix, suffix] of [
    ["module block var", "{", "} child_process.exec([[K]]x);"],
    ["function block var", "function f() { {", "} child_process.exec([[K]]x); } use([[L]]x);"],
    ["function nested block var", "function f() { { {", "} } child_process.exec([[K]]x); } use([[L]]x);"],
    ["nested function sees function var", "function f() { {", "} function g() { child_process.exec([[K]]x); } } use([[L]]x);"],
  ]) {
    test(name!, async () => {
      const r = await analyze(`${prefix} var [[D]]x = req.query.x; ${suffix}`);
      const d = definition(r, "D");
      use(r, "K", d);
      sink(r, d, true, [d]);
      if (suffix!.includes("[[L]]")) use(r, "L", undefined);
    });
  }
  test("function var shadows module binding and does not leak", async () => {
    const r = await analyze('var [[O]]x = "safe"; function f() { { var [[I]]x = req.query.x; } use([[U]]x); } child_process.exec([[K]]x);');
    use(r, "U", definition(r, "I"));
    const outer = definition(r, "O");
    use(r, "K", outer);
    sink(r, outer, false);
  });
  test("canonical outer assignment survives the block", async () => {
    const r = await analyze('let [[D]]x = ""; { [[A]]x = req.query.x; } child_process.exec([[K]]x);');
    definition(r, "D");
    const a = definition(r, "A", "x", "assignment");
    use(r, "K", a);
    sink(r, a, true, [a]);
  });
  test("nested blocks and repeated compound writes update the same owner", async () => {
    const r = await analyze('let [[D]]x = req.query.x; { { [[A]]x = [[R]]x + 1; } [[B]][[S]]x += 2; } child_process.exec([[K]]x);');
    const d = definition(r, "D"), a = definition(r, "A", "x", "assignment"), b = definition(r, "B", "x", "assignment");
    use(r, "R", d); use(r, "S", a); use(r, "K", b);
    transfer(r, d, a); transfer(r, a, b);
    sink(r, b, true, [d, a, b]);
  });
  test("assignment updates the nearest lexical shadow only", async () => {
    const r = await analyze('let [[O]]x = "safe"; { let [[I]]x = 1; { [[A]]x = req.query.x; } use([[U]]x); } child_process.exec([[K]]x);');
    const outer = definition(r, "O"); definition(r, "I");
    use(r, "U", definition(r, "A", "x", "assignment"));
    use(r, "K", outer); sink(r, outer, false);
  });
  for (const callee of ["unknownFunction", "sanitize", "validator.escape"]) {
    test(`${callee} publishes its staged receiver to the outer owner`, async () => {
      const r = await analyze(`let [[D]]x = req.query.x; { [[A]]x = ${callee}([[R]]x); } child_process.exec([[K]]x);`);
      const d = definition(r, "D"), a = definition(r, "A", "x", "assignment");
      use(r, "R", d); use(r, "K", a);
      // Public call bindings require a proven target symbol; these calls have none.
      expect(r.graph.callBindings).toEqual([]);
      const tainted = callee === "unknownFunction";
      expect(r.state.transfers.filter((item) => item.targetDefinitionId === a))
        .toEqual(tainted ? [{ sourceDefinitionId: d, targetDefinitionId: a }] : []);
      sink(r, a, tainted, [d, a]);
    });
  }
  for (const statement of ["[[A]][x] = [[[R]]x]", "([[A]]{ x } = { x: [[R]]x })"]) {
    test(`destructuring assignment publishes outside block: ${statement}`, async () => {
      const r = await analyze(`let [[D]]x = req.query.x; { ${statement}; } child_process.exec([[K]]x);`);
      const d = definition(r, "D"), a = definition(r, "A", "x", "assignment");
      use(r, "R", d); use(r, "K", a); transfer(r, d, a); sink(r, a, true, [d, a]);
    });
  }
  test("destructuring swap captures RHS before either outer publication", async () => {
    const r = await analyze('let [[DA]]a = req.query.x; let [[DB]]b = "safe"; { [[A]][a, b] = [[[RB]]b, [[RA]]a]; } use([[UA]]a); child_process.exec([[K]]b);');
    const da = definition(r, "DA", "a"), db = definition(r, "DB", "b");
    const a = definition(r, "A", "a", "assignment"), b = definition(r, "A", "b", "assignment");
    use(r, "RA", da, "a"); use(r, "RB", db, "b"); use(r, "UA", a, "a"); use(r, "K", b, "b");
    transfer(r, da, b); transfer(r, db, a); sink(r, b, true, [da, b]);
    expect(r.state.taintPaths.get(a)?.size ?? 0).toBe(0);
  });
  for (const pattern of ["[x] = [req.query.x]", "{ x } = { x: req.query.x }"]) {
    test(`var destructuring uses function owner: ${pattern}`, async () => {
      const r = await analyze(`function f() { { var [[D]]${pattern}; } child_process.exec([[K]]x); } use([[L]]x);`);
      const d = definition(r, "D"); use(r, "K", d); use(r, "L", undefined); sink(r, d, true, [d]);
    });
  }
  for (const kind of ["let", "const", "var"]) {
    test(`function-local ${kind} remains function-local`, async () => {
      const r = await analyze(`function f() { ${kind} [[D]]x = req.query.x; use([[I]]x); } child_process.exec([[K]]x);`);
      use(r, "I", definition(r, "D")); use(r, "K", undefined);
      expect(r.graph.taintFlows).toEqual([]);
    });
  }
  test("parameter shadowing and its block assignment remain function-local", async () => {
    const r = await analyze('let [[O]]x = "safe"; function f([[P]]x) { use([[R]]x); { [[A]]x = req.query.x; } use([[U]]x); } child_process.exec([[K]]x);');
    const p = definition(r, "P", "x", "parameter"), a = definition(r, "A", "x", "assignment"), o = definition(r, "O");
    use(r, "R", p); use(r, "U", a); use(r, "K", o); sink(r, o, false);
  });

  for (const [statement, tainted] of [
    ['[[A]]x = [[R]]x + ([[B]]x = "safe")', true],
    ['[[A]]x = ([[B]]x = "safe") + [[R]]x', false],
  ] as const) {
    test(`ordered nested assignment across blocks: ${statement}`, async () => {
      const r = await analyze(`let [[D]]x = req.query.x; { ${statement}; } child_process.exec([[K]]x);`);
      const d = definition(r, "D"), a = definition(r, "A", "x", "assignment"), b = definition(r, "B", "x", "assignment");
      use(r, "R", tainted ? d : b); use(r, "K", a); transfer(r, b, a);
      expect(r.state.transfers.some((t) => t.sourceDefinitionId === d && t.targetDefinitionId === a)).toBe(tainted);
      sink(r, a, tainted, [d, a]);
    });
  }
  test("local return receiver is published to its outer owner", async () => {
    const r = await analyze('function identity([[P]]v) { [[T]]return [[R]]v; } let [[D]]x = req.query.x; { [[A]]x = identity([[U]]x); } child_process.exec([[K]]x);');
    const d = definition(r, "D"), a = definition(r, "A", "x", "assignment"), p = definition(r, "P", "v", "parameter"), t = definition(r, "T", "identity:return", "return");
    use(r, "R", p, "v"); use(r, "U", d); use(r, "K", a);
    transfer(r, d, p); transfer(r, p, t); transfer(r, t, a); sink(r, a, true, [d, p, t, a]);
  });
  test("var initializer still reads its lexical block", async () => {
    const r = await analyze('let [[O]]y = "safe"; { let [[I]]y = req.query.x; var [[D]]x = [[R]]y; } child_process.exec([[K]]x);');
    const inner = definition(r, "I", "y"), d = definition(r, "D"); definition(r, "O", "y");
    use(r, "R", inner, "y"); use(r, "K", d); transfer(r, inner, d); sink(r, d, true, [inner, d]);
  });
  for (const [statement, declaration] of [
    ['var [[D]][x = req.query.x] = []', true],
    ['var [[D]][...x] = [req.query.x]', true],
    ['var [[D]]{...x} = { value: req.query.x }', true],
    ['[[D]][x = req.query.x] = []', false],
    ['[[D]][...x] = [req.query.x]', false],
    ['([[D]]{...x} = { value: req.query.x })', false],
  ] as const) {
    test(`legacy destructuring ownership: ${statement}`, async () => {
      const r = await analyze(`${declaration ? '' : 'let x;'} { ${statement}; } child_process.exec([[K]]x);`);
      const d = definition(r, "D", "x", declaration ? "declaration" : "assignment");
      use(r, "K", d); sink(r, d, true, [d]);
    });
  }
  test("legacy assignment receiver retains local-return linkage", async () => {
    // Sequence entry takes the legacy assignment path, preserving its evaluation rules.
    const r = await analyze('function source() { [[T]]return req.query.x; } let x; { ([[A]]x = source(), 0); } child_process.exec([[K]]x);');
    const a = definition(r, "A", "x", "assignment"), t = definition(r, "T", "source:return", "return");
    use(r, "K", a); transfer(r, t, a); sink(r, a, true, [t, a]);
  });
  test("for-of var uses function ownership", async () => {
    const r = await analyze('function f() { for (var [[D]]x of [req.query.x]) {} child_process.exec([[K]]x); } use([[L]]x);');
    const d = definition(r, "D"); use(r, "K", d); use(r, "L", undefined); sink(r, d, true, [d]);
  });
  test("comments do not change assignment ownership", async () => {
    const r = await analyze('let [[D]]x = req.query.x; { /*before*/ [[A]]x = /*rhs*/ [[R]]x + 1 /*after*/; } child_process.exec([[K]]x);');
    const d = definition(r, "D"), a = definition(r, "A", "x", "assignment");
    use(r, "R", d); use(r, "K", a); transfer(r, d, a); sink(r, a, true, [d, a]);
  });

  // A function boundary isolates publication; an ordinary block does not.
  test("uncalled nested function writes leave the ancestor binding active", async () => {
    const r = await analyze('function outer() { var [[D]]x = req.query.x; function inner() { use([[R]]x); { [[A]]x = "safe"; } use([[U]]x); { [[B]]x = unknownFunction([[V]]x); [[C]]x = sanitize([[W]]x); [[E]][x] = ["safe"]; } use([[Z]]x); } child_process.exec([[K]]x); }');
    const d = definition(r, "D"), a = definition(r, "A", "x", "assignment"), b = definition(r, "B", "x", "assignment"), c = definition(r, "C", "x", "assignment"), e = definition(r, "E", "x", "assignment");
    use(r, "R", d); use(r, "U", a); use(r, "V", a); use(r, "W", b); use(r, "Z", e); use(r, "K", d);
    transfer(r, a, b);
    expect(r.state.transfers.filter((t) => t.targetDefinitionId === c)).toEqual([]);
    sink(r, d, true, [d]);
  });
  test("same-function block writes replace the function-owned binding", async () => {
    const r = await analyze('function outer() { var [[D]]x = "safe"; { [[A]]x = req.query.x; } child_process.exec([[K]]x); }');
    definition(r, "D");
    const a = definition(r, "A", "x", "assignment");
    use(r, "K", a); sink(r, a, true, [a]);
  });

  test("three repeated builds and builder reuse preserve output and AST", async () => {
    const r = await analyze('function f() { { var x = req.query.x; } { x = unknownFunction(x); } child_process.exec(x); }');
    const before = JSON.stringify(r.ast);
    const digests: string[] = [];
    for (let i = 0; i < 3; i++) {
      const next = r.builder.buildContext(r.ast);
      expect(next.graph).toEqual(r.graph);
      expect(next.state.transfers).toEqual(r.state.transfers);
      expect(next.state.sinks).toEqual(r.state.sinks);
      digests.push(createHash("sha256").update(JSON.stringify(next.graph)).digest("hex"));
    }
    expect(new Set(digests).size).toBe(1);
    const empty = await analyze('child_process.exec(x);');
    expect(r.builder.build(empty.ast)).toEqual(empty.graph);
    expect(JSON.stringify(r.ast)).toBe(before);
  });
});
