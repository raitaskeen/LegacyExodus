import { readFileSync } from "node:fs";
const dir = process.argv[2]!;
const read = (n: string) => JSON.parse(readFileSync(`${dir}/.discovery/${n}`, "utf8"));
const sem = read("semantic.json"); const flow = read("data-flow.json"); const symDoc = read("symbols.json");
const syms: any[] = JSON.stringify(symDoc).length > 0 ? (function collect(v: any): any[] { if (Array.isArray(v)) return v.flatMap(collect); if (v && typeof v === "object") return v.kind && v.id ? [v] : Object.values(v).flatMap(collect); return []; })(symDoc) : [];
for (const c of sem.calls) if (c.calleeName === "h") { const t = syms.find((s) => s.id === c.targetSymbolId); console.log(`  call h: ${c.resolutionState} -> ${t ? `${t.kind} ${t.name} @${t.filePath}:${t.location?.start.line}` : "-"}`); }
const graphs: any[] = flow.graphs ?? flow;
let n = 0; for (const g of graphs) for (const t of g.taintFlows ?? []) { n++; console.log(`  taintFlow in ${g.filePath}: ${JSON.stringify(t.path)}`); }
console.log(`  total taint flows: ${n}`);
