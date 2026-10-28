// F-003 red-team probe. Run from a copy's legacy-exodus-core dir: bun <this file> <label>
// Builds CFGs for adversarial programs and checks them against independent oracles.
import { resolve } from "node:path";

const root = process.cwd();
const { DeterministicControlFlowGraphBuilder } = await import(resolve(root, "src/flow/control-flow-builder.ts"));
const { JavaScriptParser } = await import(resolve(root, "src/parser/index.ts"));

type G = any;

const programs: Record<string, string> = {
  p01_switch_continue: `function f(n,x){ for (let i=0;i<n;i++){ switch(x){ case 1: continue; default: break; } g(); } h(); }`,
  p02_labelled_finally: `function f(n){ outer: for (let i=0;i<n;i++){ let j=0; while(j<n){ try { if (j) continue outer; j++; } finally { k(); } } } done(); }`,
  p03_forever_break: `function f(){ for(;;){ if (a()) break; } after(); }`,
  p04_forever_update: `function f(){ let i=0; for(;;i++){ g(i); } after(); }`,
  p05_test_false: `function f(){ for (let i=0; false; i++) { g(); } after(); }`,
  p06_while_true_return: `function f(){ while(true){ if (a()) return 1; } after(); }`,
  p07_forof_throwing_right: `function f(){ try { for (const x of g()) { h(x); } } catch (e) { c(); } }`,
  p08_forin_member_left: `function f(o,obj){ try { for (o.p in obj) { h(); } } catch (e) { c(); } }`,
  p09_update_throws: `function f(n){ try { for (let i=0;i<n;i=step(i)) { h(); } } catch (e) { c(); } }`,
  p10_labelled_clause_throws: `function f(){ try { L: for (let i=f0(); i<g0(); i=h0(i)) { b(); } } catch (e) { c(); } }`,
  p11_loop_first_in_try: `function f(a){ try { while(a.b) { g(); } } catch (e) { c(); } }`,
  p12_nested_forever: `function f(){ for(;;){ for(;;){ break; } g(); } }`,
  p13_do_for_mix: `function f(n){ do { for (let i=0;i<n;i++) { if (i) continue; g(); } } while (c()); for (let k=0;k<n;k++) { do { if (k) continue; } while (d()); } }`,
  p14_body_ends_continue: `function f(n){ for (let i=0;i<n;i++){ g(); continue; } h(); }`,
  p15_unbraced_body: `function f(n,x){ for (i=0;i<n;i++) if (x) continue; else g(); h(); }`,
  p16_continue_in_finally: `function f(n){ for (let i=0;i<n;i++){ try { g(); } finally { if (i) continue; } } h(); }`,
  p17_multi_init: `function f(n){ for (var i = 0, j = mk(); i < j; i++, j--) { g(i, j); } }`,
  p18_switch_in_inner: `function f(n,x){ a: for (let i=0;i<n;i++){ for (const y of x){ switch(y){ case 1: continue a; case 2: break a; } } } }`,
  p19_labelled_block_break: `function f(){ L: { for(;;){ break L; } } after(); }`,
  p20_unreachable_loop: `function f(x,y){ return; while(x){ if(y) continue; g(); } }`,
  p21_for_await: `async function f(it){ for await (const x of it) { if (x) continue; g(x); } }`,
  p22_return_in_body: `function f(n){ for (let i=0;i<n;i++){ return g(i); } h(); }`,
  p23_while_after_stmt: `function f(){ a(); b(); while (c()) { d(); } e(); }`,
  p24_nested_continue_both: `function f(n){ o: for (let i=0;i<n;i++){ for (let j=0;j<n;j++){ if (j) continue o; if (i) continue; g(); } } }`,
  p25_loop_in_catch_finally: `function f(n){ try { t(); } catch (e) { for (let i=0;i<n;i++) { if (i) continue; } } finally { for (const k of ks()) { z(k); } } }`,
};

function reach(g: G, removed?: string): Set<string> {
  const seen = new Set<string>();
  if (g.entryBlockId === removed) return seen;
  const stack = [g.entryBlockId];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id) || id === removed) continue;
    seen.add(id);
    for (const e of g.edges) if (e.fromBlockId === id) stack.push(e.toBlockId);
  }
  return seen;
}

// Dominance by removal: d dominates n iff n is unreachable once d is removed. Independent of any fixpoint.
function oracleIdoms(g: G): Map<string, string | undefined> {
  const live = reach(g);
  const ids: string[] = g.blocks.map((b: any) => b.id).filter((id: string) => live.has(id));
  const doms = new Map<string, Set<string>>(ids.map((id) => [id, new Set([id])]));
  for (const d of ids) {
    const without = reach(g, d);
    for (const n of ids) if (n !== d && !without.has(n)) doms.get(n)!.add(d);
  }
  const out = new Map<string, string | undefined>();
  for (const n of ids) {
    if (n === g.entryBlockId) continue;
    const strict = [...doms.get(n)!].filter((d) => d !== n);
    out.set(n, strict.find((c) => strict.every((o) => doms.get(c)!.has(o))));
  }
  return out;
}

function oracleLoops(g: G, idoms: Map<string, string | undefined>): Map<string, Set<string>> {
  const live = reach(g);
  const dominates = (d: string, n: string): boolean => { for (let c: string | undefined = n; c !== undefined; c = idoms.get(c)) if (c === d) return true; return false; };
  const loops = new Map<string, Set<string>>();
  for (const e of g.edges) {
    if (!live.has(e.fromBlockId) || !dominates(e.toBlockId, e.fromBlockId)) continue;
    const body = loops.get(e.toBlockId) ?? new Set([e.toBlockId]);
    const stack = [e.fromBlockId];
    while (stack.length) { const n = stack.pop()!; if (body.has(n)) continue; body.add(n); for (const p of g.edges) if (p.toBlockId === n && live.has(p.fromBlockId)) stack.push(p.fromBlockId); }
    loops.set(e.toBlockId, body);
  }
  return loops;
}

function label(g: G, id: string): string {
  const b = g.blocks.find((x: any) => x.id === id);
  if (id === g.entryBlockId) return "ENTRY";
  if (id === g.exitBlockId) return "EXIT";
  const s = b?.statements.map((n: any) => `${n.type}@${n.location?.column ?? "?"}`).join(",") ?? "";
  return `[${s || "∅"}]#${g.blocks.indexOf(b)}`;
}

const parser = new JavaScriptParser();
const summary: string[] = [];
for (const [name, source] of Object.entries(programs)) {
  const ast = (await parser.parse({ file: { id: name, path: `src/${name}.js`, language: "javascript", size: source.length }, source })).result;
  if (ast.errors.length) { summary.push(`${name}: PARSE ERROR ${JSON.stringify(ast.errors)}`); continue; }
  const g: G = new DeterministicControlFlowGraphBuilder().buildAll(ast).find((x: any) => x.scopeName.startsWith("f@"));
  const problems: string[] = [];
  const live = reach(g);
  if (g.edges.some((e: any) => e.toBlockId === g.entryBlockId)) problems.push("entry has incoming edge");
  const ids = g.blocks.flatMap((b: any) => b.statements.map((s: any) => s.id));
  if (new Set(ids).size !== ids.length) problems.push("duplicate statement ids");
  const idoms = oracleIdoms(g);
  for (const [n, d] of idoms) {
    const got = g.dominators.find((x: any) => x.blockId === n)?.immediateDominatorId;
    if (got !== d) problems.push(`idom ${label(g, n)}: got ${got ? label(g, got) : "none"} want ${d ? label(g, d) : "none"}`);
  }
  const want = oracleLoops(g, idoms);
  const got = new Map<string, Set<string>>(g.loops.filter((l: any) => live.has(l.headerBlockId)).map((l: any) => [l.headerBlockId, new Set(l.blockIds.filter((b: string) => live.has(b)))]));
  for (const [h, body] of want) {
    const other = got.get(h);
    if (!other) problems.push(`missing loop at ${label(g, h)}`);
    else if ([...body].some((b) => !other.has(b)) || [...other].some((b) => !body.has(b))) problems.push(`loop body mismatch at ${label(g, h)}: got ${[...other].map((b) => label(g, b)).join(" ")} want ${[...body].map((b) => label(g, b)).join(" ")}`);
  }
  for (const h of got.keys()) if (!want.has(h)) problems.push(`spurious reachable loop at ${label(g, h)}`);
  const deadLoops = g.loops.filter((l: any) => !live.has(l.headerBlockId)).length;
  const exc = g.edges.filter((e: any) => e.kind === "exception").map((e: any) => `${label(g, e.fromBlockId)}->${label(g, e.toBlockId)}`);
  summary.push(`${name}: blocks=${g.blocks.length} loops=${g.loops.length} deadLoops=${deadLoops} exc=[${exc.join(" ; ")}] ${problems.length ? "PROBLEMS: " + problems.join(" | ") : "ok"}`);
  if (process.argv[3] === name) {
    for (const e of g.edges) console.log(`  ${label(g, e.fromBlockId)} -${e.kind}-> ${label(g, e.toBlockId)}${live.has(e.fromBlockId) ? "" : " (dead)"}`);
  }
}
console.log(`== ${process.argv[2]}`);
for (const line of summary) console.log(line);
