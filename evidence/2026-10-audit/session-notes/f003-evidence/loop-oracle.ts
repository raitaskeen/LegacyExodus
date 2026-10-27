// Independent oracle: textbook dominators over the reachable subgraph, back edges T->H with H dom T,
// natural loop = H plus every block that reaches T without passing H. Compared with the emitted loops.
import { readFileSync } from "node:fs";
import { join } from "node:path";
type G = { scopeName: string; filePath: string; entryBlockId: string; blocks: { id: string; statements: { type: string; location?: { line: number } }[] }[]; edges: { fromBlockId: string; toBlockId: string; kind: string }[]; loops: { headerBlockId: string; blockIds: string[] }[]; dominators: { blockId: string; immediateDominatorId?: string }[] };
for (const dir of process.argv.slice(2)) {
  const raw = JSON.parse(readFileSync(join(dir, "control-flow.json"), "utf8")); const graphs = (raw.graphs ?? raw) as G[];
  const c = { oracleLoops: 0, emittedReachableLoops: 0, loopsMissingMembers: 0, missingBlocks: 0, extraReachableBlocks: 0, emittedNotOracle: 0, oracleNotEmitted: 0, idomMismatch: 0, headerIdomMismatch: 0 };
  const examples: string[] = [];
  for (const g of graphs) {
    const succ = new Map<string, string[]>(), pred = new Map<string, string[]>();
    for (const e of g.edges) { (succ.get(e.fromBlockId) ?? succ.set(e.fromBlockId, []).get(e.fromBlockId)!).push(e.toBlockId); (pred.get(e.toBlockId) ?? pred.set(e.toBlockId, []).get(e.toBlockId)!).push(e.fromBlockId); }
    const reach = new Set<string>(); { const t = [g.entryBlockId]; while (t.length) { const x = t.pop()!; if (reach.has(x)) continue; reach.add(x); t.push(...(succ.get(x) ?? [])); } }
    const nodes = [...reach]; const dom = new Map<string, Set<string>>();
    for (const n of nodes) dom.set(n, n === g.entryBlockId ? new Set([n]) : new Set(nodes));
    for (let changed = true; changed;) { changed = false; for (const n of nodes) { if (n === g.entryBlockId) continue; const ps = (pred.get(n) ?? []).filter((p) => reach.has(p)); let s: Set<string> | undefined; for (const p of ps) { const d = dom.get(p)!; s = s === undefined ? new Set(d) : new Set([...s].filter((x) => d.has(x))); } const next = new Set([...(s ?? []), n]); if (next.size !== dom.get(n)!.size) { dom.set(n, next); changed = true; } } }
    const idomOf = (n: string) => { const ds = [...dom.get(n)!].filter((x) => x !== n); return ds.find((d) => ds.every((o) => o === d || dom.get(d)!.has(o))); };
    const emittedIdom = new Map(g.dominators.map((d) => [d.blockId, d.immediateDominatorId]));
    for (const n of nodes) if (n !== g.entryBlockId && idomOf(n) !== emittedIdom.get(n)) { c.idomMismatch++; if (g.loops.some((l) => l.headerBlockId === n)) c.headerIdomMismatch++; }
    const oracle = new Map<string, Set<string>>();
    for (const e of g.edges) { if (!reach.has(e.fromBlockId) || !dom.get(e.fromBlockId)!.has(e.toBlockId)) continue; const H = e.toBlockId; const body = oracle.get(H) ?? new Set([H]); const t = [e.fromBlockId]; while (t.length) { const x = t.pop()!; if (body.has(x)) continue; body.add(x); t.push(...(pred.get(x) ?? []).filter((p) => reach.has(p))); } oracle.set(H, body); }
    c.oracleLoops += oracle.size;
    const emitted = new Map(g.loops.map((l) => [l.headerBlockId, new Set(l.blockIds)]));
    for (const [H, want] of oracle) { const got = emitted.get(H); if (!got) { c.oracleNotEmitted++; continue; } const miss = [...want].filter((b) => !got.has(b)); if (miss.length) { c.loopsMissingMembers++; c.missingBlocks += miss.length; if (examples.length < 6) { const hb = g.blocks.find((b) => b.id === H); examples.push(`MISSING ${miss.length} ${g.filePath} ${g.scopeName} header@${hb?.statements.map((s) => `${s.type}:${s.location?.line}`).join("|")}`); } } c.extraReachableBlocks += [...got].filter((b) => reach.has(b) && !want.has(b)).length; }
    for (const [H] of emitted) if (reach.has(H)) { c.emittedReachableLoops++; if (!oracle.has(H)) c.emittedNotOracle++; }
  }
  console.log(`${dir.split(/[\/]/).pop()}: ${JSON.stringify(c)}`);
  for (const e of examples) console.log(`   ${e}`);
}
