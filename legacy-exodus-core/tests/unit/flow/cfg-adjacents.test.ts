import { createHash } from "node:crypto";
import { describe, expect, it } from "bun:test";
import { JavaScriptParser } from "../../../src/parser/adapters/javascript/javascript-parser";
import { DeterministicControlFlowGraphBuilder } from "../../../src/flow/control-flow-builder";
import type { ControlFlowGraph } from "../../../src/flow/flow-contracts";

/**
 * BA-14 CFG adjacents (audits/2026-10-28-blind-audit):
 *   A2  a loop body that cannot reach its own end has no back edge, hence no natural loop;
 *   A1' every statement occurrence in a graph (finally is copied per completion kind) has a unique id;
 *   A3  a labelled loop evaluates its init/test/update clauses exactly like the unlabelled loop.
 */

async function cfgsOf(code: string, filePath = "test.js"): Promise<readonly ControlFlowGraph[]> {
  const response = await new JavaScriptParser().parse({ file: { id: "f1", path: filePath, language: "javascript", size: code.length }, source: code });
  return new DeterministicControlFlowGraphBuilder().buildAll(response.result);
}

async function scopeOf(code: string, name: string): Promise<ControlFlowGraph> {
  const cfg = (await cfgsOf(code)).find((candidate) => candidate.scopeName.startsWith(`${name}@`));
  if (cfg === undefined) throw new Error(`scope ${name} not found`);
  return cfg;
}

function reachableFromEntry(cfg: ControlFlowGraph): Set<string> {
  const seen = new Set<string>();
  const pending = [cfg.entryBlockId];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const edge of cfg.edges) if (edge.fromBlockId === id) pending.push(edge.toBlockId);
  }
  return seen;
}

function statementIds(cfg: ControlFlowGraph): string[] {
  return cfg.blocks.flatMap((block) => block.statements.map((statement) => statement.id));
}

/** Order-independent description of a block: statement types, ignoring the label wrapper. */
function signature(cfg: ControlFlowGraph, blockId: string): string {
  const block = cfg.blocks.find((candidate) => candidate.id === blockId);
  return (block?.statements ?? []).map((statement) => statement.type).filter((type) => type !== "LabeledStatement").join("+") || "(empty)";
}

function exceptionEdges(cfg: ControlFlowGraph): string[] {
  return cfg.edges.filter((edge) => edge.kind === "exception").map((edge) => `${signature(cfg, edge.fromBlockId)} -> ${signature(cfg, edge.toBlockId)}`).sort();
}

describe("BA-14 A2: no natural loop from an unreachable back-edge source", () => {
  it("a loop body that always returns has no loop and no loop-back edge out of reachable code", async () => {
    const cfg = await scopeOf(`export function early(n) { for (let i = 0; i < n; i++) { return 1; } return 0; }`, "early");
    const live = reachableFromEntry(cfg);
    expect(cfg.loops).toEqual([]);
    expect(cfg.edges.filter((edge) => edge.kind === "loop-back" && live.has(edge.fromBlockId))).toEqual([]);
  });

  const alwaysLeaves: Readonly<Record<string, string>> = {
    "for with return": `function f(n) { for (let i = 0; i < n; i++) { return g(i); } h(); }`,
    "for with break": `function f(n) { for (let i = 0; i < n; i++) { break; } h(); }`,
    "for with continue (loops back through the update)": `function f(n) { for (let i = 0; i < n; i++) { continue; } h(); }`,
    "while with return": `function f(c) { while (c()) { return 1; } h(); }`,
    "for-of with throw": `function f(xs) { for (const x of xs) { throw x; } h(); }`,
    "for-in with return": `function f(o) { for (const k in o) { return k; } h(); }`,
    "if/else where both arms leave": `function f(n) { for (let i = 0; i < n; i++) { if (a()) { return 1; } else { return 2; } } h(); }`,
    "dead statements after the return": `function f(n) { for (let i = 0; i < n; i++) { return 1; if (x()) { g(); } } h(); }`,
    "do-while whose body returns": `function f(c) { do { return 1; } while (c()); }`,
    "labelled for with return": `function f(n) { L: for (let i = 0; i < n; i++) { return 1; } h(); }`,
  };
  for (const [name, code] of Object.entries(alwaysLeaves)) {
    it(`${name}: loops are exactly the reachable ones, with reachable headers and back-edge sources`, async () => {
      const cfg = await scopeOf(code, "f");
      const live = reachableFromEntry(cfg);
      // "continue" is the one case that really loops: the update block is reachable through the continue edge.
      const expectedLoops = name.startsWith("for with continue") ? 1 : 0;
      expect(cfg.loops).toHaveLength(expectedLoops);
      for (const loop of cfg.loops) expect(live.has(loop.headerBlockId)).toBe(true);
      for (const loop of cfg.loops) {
        const backEdgeFromLiveCode = cfg.edges.some((edge) => edge.toBlockId === loop.headerBlockId && edge.kind !== "next" && live.has(edge.fromBlockId) && loop.blockIds.includes(edge.fromBlockId));
        expect(backEdgeFromLiveCode).toBe(true);
      }
    });
  }

  it("a loop in dead code is not a natural loop of the reachable graph", async () => {
    const cfg = await scopeOf(`function f(x, y) { return; while (x) { if (y) continue; g(); } }`, "f");
    expect(cfg.loops).toEqual([]);
  });

  it("control: the real outer loop of for(;;){ for(;;){ break; } g(); } is kept, the inner break-only loop is not", async () => {
    const source = `function f() { for (;;) { for (;;) { break; } g(); } }`;
    const cfg = await scopeOf(source, "f");
    const outerHeader = cfg.blocks.find((block) => block.statements.some((statement) => statement.type === "ForStatement" && statement.location?.column === source.indexOf("for (;;)")));
    const innerHeader = cfg.blocks.find((block) => block.statements.some((statement) => statement.type === "ForStatement" && statement.location?.column === source.lastIndexOf("for (;;)")));
    const afterInner = cfg.blocks.find((block) => block.statements.some((statement) => statement.type === "ExpressionStatement"));
    expect(outerHeader).toBeDefined();
    expect(innerHeader).toBeDefined();
    expect(afterInner).toBeDefined();
    expect(cfg.loops).toHaveLength(1);
    expect(cfg.loops[0]!.headerBlockId).toBe(outerHeader!.id);
    expect(cfg.loops[0]!.blockIds).toContain(innerHeader!.id);
    expect(cfg.loops[0]!.blockIds).toContain(afterInner!.id);
    const live = reachableFromEntry(cfg);
    expect(cfg.edges.filter((edge) => edge.kind === "loop-back" && live.has(edge.fromBlockId)).map((edge) => [edge.fromBlockId, edge.toBlockId])).toEqual([[afterInner!.id, outerHeader!.id]]);
  });

  it("control: a loop whose body can both leave and fall through keeps its loop", async () => {
    const cfg = await scopeOf(`function f(n) { for (let i = 0; i < n; i++) { if (a()) { return 1; } g(i); } h(); }`, "f");
    const live = reachableFromEntry(cfg);
    expect(cfg.loops).toHaveLength(1);
    expect(cfg.edges.filter((edge) => edge.kind === "loop-back" && live.has(edge.fromBlockId))).toHaveLength(1);
  });

  it("control: a loop whose only exit is break keeps its loop (for(;;) with a conditional break)", async () => {
    const cfg = await scopeOf(`function f() { for (;;) { if (a()) break; } after(); }`, "f");
    expect(cfg.loops).toHaveLength(1);
  });
});

describe("BA-14 duplicate ids: every statement occurrence in a graph has a unique id", () => {
  const finallyPrograms: Readonly<Record<string, string>> = {
    "labelled continue through finally (probe p02)": `function f(n){ outer: for (let i=0;i<n;i++){ let j=0; while(j<n){ try { if (j) continue outer; j++; } finally { k(); } } } done(); }`,
    "normal, throw and return completions": `function f(x){ try { if (x) return 1; if (y) throw e; g(); } finally { k(); } }`,
    "break and continue completions": `function f(n){ for(;;){ try { if (n) break; if (m) continue; g(); } finally { k(); } } }`,
    "nested try/finally": `function f(x){ try { try { if (x) return 1; g(); } finally { k(); } } finally { h(); } }`,
    "try/finally inside a copied finalizer": `function f(x){ try { if (x) return 1; } finally { try { g(); } finally { h(); } } }`,
    "catch and finally": `function f(x){ try { if (x) return 1; g(); } catch (e) { r(); } finally { k(); } }`,
    "labelled break through finally": `function f(n){ L: { for(;;){ try { if (n) break L; } finally { k(); } } } }`,
  };
  for (const [name, code] of Object.entries(finallyPrograms)) {
    it(`${name}: statement ids are unique within each graph`, async () => {
      for (const cfg of await cfgsOf(code)) {
        const ids = statementIds(cfg);
        expect(new Set(ids).size).toBe(ids.length);
      }
    });
  }

  it("the finalizer is still present once per completion kind that reaches it (probe p02: normal + labelled continue)", async () => {
    const code = finallyPrograms["labelled continue through finally (probe p02)"]!;
    const cfg = await scopeOf(code, "f");
    const copies = cfg.blocks.flatMap((block) => block.statements).filter((statement) => statement.type === "ExpressionStatement" && statement.location?.column === code.indexOf("k();"));
    expect(copies.length).toBe(2);
    expect(new Set(copies.map((statement) => statement.id)).size).toBe(2);
  });

  it("the normal-completion copy keeps its source-position id; other copies derive different ids", async () => {
    const code = `function f(x){ try { if (x) return 1; g(); } finally { k(); } }`;
    const cfg = await scopeOf(code, "f");
    const column = code.indexOf("k();");
    const copies = cfg.blocks.flatMap((block) => block.statements).filter((statement) => statement.type === "ExpressionStatement" && statement.location?.column === column);
    expect(copies.length).toBe(2);
    const canonical = createHash("sha256").update(`test.js:ExpressionStatement:1:${column}`).digest("hex");
    expect(copies.filter((statement) => statement.id === canonical)).toHaveLength(1);
  });

  it("ids are deterministic across runs and unchanged for code without copies", async () => {
    const code = `function f(x){ try { if (x) return 1; g(); } finally { k(); } }\nfunction plain(){ a(); b(); }`;
    expect(JSON.stringify(await cfgsOf(code))).toBe(JSON.stringify(await cfgsOf(code)));
    const plain = await scopeOf(code, "plain");
    const first = plain.blocks.flatMap((block) => block.statements).find((statement) => statement.type === "ExpressionStatement")!;
    expect(first.id).toBe(createHash("sha256").update(`test.js:ExpressionStatement:2:${first.location!.column}`).digest("hex"));
  });
});

describe("BA-14 A3: labelled loops raise clause exceptions exactly like unlabelled loops", () => {
  it("for(init;test;update) in try: init, test, update and body all reach the handler, labelled or not", async () => {
    const unlabelled = await scopeOf(`function f(){ try { for (let i=f0(); i<g0(); i=h0(i)) { b(); } } catch (e) { c(); } }`, "f");
    const labelled = await scopeOf(`function f(){ try { L: for (let i=f0(); i<g0(); i=h0(i)) { b(); } } catch (e) { c(); } }`, "f");
    const expected = [
      "AssignmentExpression -> ExpressionStatement",
      "ExpressionStatement -> ExpressionStatement",
      "ForStatement -> ExpressionStatement",
      "VariableDeclaration -> ExpressionStatement",
    ];
    expect(exceptionEdges(unlabelled)).toEqual(expected);
    expect(exceptionEdges(labelled)).toEqual(expected);
  });

  const parity: Readonly<Record<string, [string, string]>> = {
    "for-of with throwing right": [`for (const x of g()) { h(x); }`, `L: for (const x of g()) { h(x); }`],
    "for-in with member left": [`for (o.p in obj) { h(); }`, `L: for (o.p in obj) { h(); }`],
    "while with throwing test": [`while (a.b) { g(); }`, `L: while (a.b) { g(); }`],
    "do-while with throwing test": [`do { g(); } while (d());`, `L: do { g(); } while (d());`],
    "for with only a throwing update": [`for (let i=0; i<n; i=step(i)) { h(); }`, `L: for (let i=0; i<n; i=step(i)) { h(); }`],
    "doubly labelled for": [`for (let i=f0(); i<g0(); i=h0(i)) { b(); }`, `A: B: for (let i=f0(); i<g0(); i=h0(i)) { b(); }`],
  };
  for (const [name, [plain, labelled]] of Object.entries(parity)) {
    it(`${name}: same exception edges as the unlabelled loop`, async () => {
      const wrap = (loop: string): string => `function f(n, o, obj){ try { ${loop} } catch (e) { c(); } }`;
      const want = exceptionEdges(await scopeOf(wrap(plain), "f"));
      expect(want.length).toBeGreaterThan(1);
      expect(exceptionEdges(await scopeOf(wrap(labelled), "f"))).toEqual(want);
    });
  }

  it("labelled loop inside try/finally reaches the finalizer exactly like the unlabelled loop", async () => {
    const wrap = (loop: string): string => `function f(){ try { try { ${loop} } finally { z(); } } catch (e) { c(); } }`;
    const loop = `for (let i=f0(); i<g0(); i=h0(i)) { b(); }`;
    const want = [...(await scopeOf(wrap(loop), "f")).edges.filter((edge) => edge.kind === "exception" || edge.kind === "finally")].length;
    expect(want).toBeGreaterThan(3);
    const labelled = await scopeOf(wrap(`L: ${loop}`), "f");
    expect(labelled.edges.filter((edge) => edge.kind === "exception" || edge.kind === "finally")).toHaveLength(want);
  });

  it("control: outside any try a labelled loop adds no exception edges", async () => {
    const cfg = await scopeOf(`function f(){ L: for (let i=f0(); i<g0(); i=h0(i)) { b(); } }`, "f");
    expect(cfg.edges.filter((edge) => edge.kind === "exception")).toEqual([]);
  });
});
