// Usage: bun run compare-flow.ts <baseDiscoveryDir> <candidateDiscoveryDir>
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const [baseDir, candDir] = [process.argv[2]!, process.argv[3]!];
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16);
console.log("## file digests (base -> candidate)");
for (const f of readdirSync(baseDir).sort()) console.log(`${f.padEnd(22)} ${sha(join(baseDir, f))} -> ${sha(join(candDir, f))} ${sha(join(baseDir, f)) === sha(join(candDir, f)) ? "IDENTICAL" : "DIFFERENT"}`);
type Node = { id: string; type: string; location?: { line: number; column: number } };
type Block = { id: string; statements: Node[]; predecessorIds: string[]; successorIds: string[] };
type Edge = { fromBlockId: string; toBlockId: string; kind: string };
type Graph = { id: string; scopeName: string; filePath: string; state: string; entryBlockId: string; exitBlockId: string; blocks: Block[]; edges: Edge[]; loops: { headerBlockId: string; blockIds: string[] }[]; unreachableBlockIds: string[]; deadCodeNodeIds: string[]; dominators: unknown[] };
const load = (d: string): Graph[] => { const raw = JSON.parse(readFileSync(join(d, "control-flow.json"), "utf8")); return (raw.graphs ?? raw) as Graph[]; };
const HEADER = new Set(["WhileStatement", "ForStatement", "ForInStatement", "ForOfStatement"]);
const LOOPS = new Set([...HEADER, "DoWhileStatement"]);
function metrics(graphs: Graph[]) {
  const m: Record<string, number> = { graphs: graphs.length, blocks: 0, edges: 0, statements: 0, loops: 0, unreachableBlocks: 0, deadCodeNodes: 0, resolved: 0, unsupported: 0,
    entryWithIncoming: 0, loopsContainingEntry: 0, reachableWithoutIdom: 0, loopHeadersWithoutIdom: 0, loopsOnlyFromUnreachableTails: 0, graphsWithBrokenDominatorTree: 0, headersWithExtraStatements: 0, extraStatementsInHeaders: 0, statementsInsideSomeLoop: 0, loopMemberships: 0 };
  const kinds: Record<string, number> = {};
  const nodeTypes: Record<string, number> = {};
  for (const g of graphs) {
    m.blocks += g.blocks.length; m.edges += g.edges.length; m.loops += g.loops.length; m.unreachableBlocks += g.unreachableBlockIds.length; m.deadCodeNodes += g.deadCodeNodeIds.length;
    if (g.state === "RESOLVED") m.resolved++; else m.unsupported++;
    for (const e of g.edges) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
    if (g.edges.some((e) => e.toBlockId === g.entryBlockId)) m.entryWithIncoming++;
    const byId = new Map(g.blocks.map((b) => [b.id, b]));
    const reach = new Set<string>(); const todo = [g.entryBlockId]; while (todo.length) { const x = todo.pop()!; if (reach.has(x)) continue; reach.add(x); for (const e of g.edges) if (e.fromBlockId === x) todo.push(e.toBlockId); }
    const idom = new Map((g.dominators as { blockId: string; immediateDominatorId?: string }[]).map((d) => [d.blockId, d.immediateDominatorId]));
    const missing = [...reach].filter((b) => b !== g.entryBlockId && idom.get(b) === undefined).length; m.reachableWithoutIdom += missing; if (missing > 0) m.graphsWithBrokenDominatorTree++;
    for (const l of g.loops) { if (reach.has(l.headerBlockId) && idom.get(l.headerBlockId) === undefined && l.headerBlockId !== g.entryBlockId) m.loopHeadersWithoutIdom++; const tails = g.edges.filter((e) => e.toBlockId === l.headerBlockId && l.blockIds.includes(e.fromBlockId)); if (tails.length > 0 && tails.every((e) => !reach.has(e.fromBlockId))) m.loopsOnlyFromUnreachableTails++; }
    const inLoop = new Set<string>();
    for (const l of g.loops) {
      if (l.blockIds.includes(g.entryBlockId)) m.loopsContainingEntry++;
      for (const b of l.blockIds) { inLoop.add(b); m.loopMemberships += byId.get(b)?.statements.length ?? 0; }
      const h = byId.get(l.headerBlockId);
      if (h && h.statements.some((s) => HEADER.has(s.type)) && h.statements.length > 1) { m.headersWithExtraStatements++; m.extraStatementsInHeaders += h.statements.length - 1; }
    }
    for (const b of g.blocks) { m.statements += b.statements.length; for (const s of b.statements) nodeTypes[s.type] = (nodeTypes[s.type] ?? 0) + 1; if (inLoop.has(b.id)) m.statementsInsideSomeLoop += b.statements.length; }
  }
  return { m, kinds, nodeTypes };
}
const [base, cand] = [load(baseDir), load(candDir)];
const [mb, mc] = [metrics(base), metrics(cand)];
console.log("\n## CFG aggregate metrics (base -> candidate, delta)");
for (const k of Object.keys(mb.m)) console.log(`${k.padEnd(28)} ${String(mb.m[k]).padStart(9)} -> ${String(mc.m[k]).padStart(9)}  ${(mc.m[k]! - mb.m[k]!) >= 0 ? "+" : ""}${mc.m[k]! - mb.m[k]!}`);
console.log("\n## edge kinds");
for (const k of [...new Set([...Object.keys(mb.kinds), ...Object.keys(mc.kinds)])].sort()) console.log(`${k.padEnd(12)} ${String(mb.kinds[k] ?? 0).padStart(8)} -> ${String(mc.kinds[k] ?? 0).padStart(8)}  ${(mc.kinds[k] ?? 0) - (mb.kinds[k] ?? 0)}`);
console.log("\n## block node types whose count changed");
for (const k of [...new Set([...Object.keys(mb.nodeTypes), ...Object.keys(mc.nodeTypes)])].sort()) if ((mb.nodeTypes[k] ?? 0) !== (mc.nodeTypes[k] ?? 0)) console.log(`${k.padEnd(26)} ${String(mb.nodeTypes[k] ?? 0).padStart(8)} -> ${String(mc.nodeTypes[k] ?? 0).padStart(8)}`);
// Per-graph identity: same graph ids/scopes, same states; statement multiset differs only by added loop clauses.
const key = (g: Graph) => g.id;
const bmap = new Map(base.map((g) => [key(g), g])), cmap = new Map(cand.map((g) => [key(g), g]));
const sameIds = base.length === cand.length && base.every((g) => cmap.has(key(g)));
console.log(`\n## graph identity: same graph ids=${sameIds}, state changes=${base.filter((g) => cmap.get(key(g))?.state !== g.state).length}, loop-count changes=${base.filter((g) => cmap.get(key(g))?.loops.length !== g.loops.length).length}`);
let unexplained = 0, changedGraphs = 0, graphsWithLoops = 0;
const added: Record<string, number> = {};
for (const g of base) {
  const c = cmap.get(key(g)); if (!c) continue;
  if (g.loops.length > 0 || g.blocks.some((b) => b.statements.some((s) => LOOPS.has(s.type)))) graphsWithLoops++;
  if (JSON.stringify(g) !== JSON.stringify(c)) changedGraphs++;
  const ms = (x: Graph) => { const r = new Map<string, number>(); for (const b of x.blocks) for (const s of b.statements) r.set(s.id, (r.get(s.id) ?? 0) + 1); return r; };
  const [bs, cs] = [ms(g), ms(c)];
  const typeOf = new Map(c.blocks.flatMap((b) => b.statements.map((s) => [s.id, s.type] as const)));
  for (const [id, n] of bs) if ((cs.get(id) ?? 0) !== n) { unexplained++; if (unexplained <= 5) console.log(`  statement ${id} count ${n} -> ${cs.get(id) ?? 0} in ${g.scopeName} ${g.filePath}`); }
  for (const [id, n] of cs) if (!bs.has(id)) added[typeOf.get(id) ?? "?"] = (added[typeOf.get(id) ?? "?"] ?? 0) + n;
}
console.log(`graphs whose CFG JSON changed=${changedGraphs}; graphs containing a loop statement=${graphsWithLoops}; pre-existing statements whose occurrence count changed=${unexplained}`);
console.log(`statements added (loop clauses split out), by type: ${JSON.stringify(added)}`);
const changedWithoutLoop = base.filter((g) => JSON.stringify(g) !== JSON.stringify(cmap.get(key(g))) && !g.blocks.some((b) => b.statements.some((s) => LOOPS.has(s.type))));
console.log(`changed graphs with no loop statement=${changedWithoutLoop.length}`);
for (const g of changedWithoutLoop.slice(0, 5)) console.log(`  ${g.scopeName} ${g.filePath}`);
