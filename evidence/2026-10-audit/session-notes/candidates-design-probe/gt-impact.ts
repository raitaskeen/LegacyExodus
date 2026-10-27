import { readFileSync } from "node:fs";
const { expressGroundTruth } = await import("C:/Users/Grace Computers/Projects/LegacyExodus-f002-call-resolution/legacy-exodus-core/benchmarks/fidelity/express-ground-truth.ts");
const { fastifyGroundTruth } = await import("C:/Users/Grace Computers/Projects/LegacyExodus-f002-call-resolution/legacy-exodus-core/benchmarks/fidelity/fastify-ground-truth.ts");
for (const [label, gt] of [["express", expressGroundTruth], ["fastify", fastifyGroundTruth]] as const) {
  const est = JSON.parse(readFileSync(`C:/Users/GRACEC~1/AppData/Local/Temp/claude/C--Users-Grace-Computers-Projects-LegacyExodus--claude-worktrees-hungry-mcclintock-8c0a36/0dbcb070-bcd6-457c-b216-1f7ae209b9c8/scratchpad/probe/estimate-${label}.json`, "utf8"));
  const f = JSON.parse(readFileSync(`C:/Users/GRACEC~1/AppData/Local/Temp/claude/C--Users-Grace-Computers-Projects-LegacyExodus--claude-worktrees-hungry-mcclintock-8c0a36/0dbcb070-bcd6-457c-b216-1f7ae209b9c8/scratchpad/probe/f002-${label}.json`, "utf8"));
  const sym = new Map(f.symbols.map((s: any) => [s.id, s]));
  for (const fact of gt.filter((g: any) => g.category === "call")) {
    const a = fact.attributes;
    const preds = f.calls.filter((c: any) => c.sourceFilePath === a.sourceFilePath && c.calleeName === a.calleeName);
    const rows = est.rows.filter((r: any) => r.file === a.sourceFilePath && r.callee === a.calleeName && r.h2?.candidates.length);
    const states = [...new Set(preds.map((c: any) => c.resolutionState))].join("/");
    if (rows.length) console.log(label, fact.id, "gt=" + (a.resolutionState ?? "-"), "f002=" + states, "candidates:", [...new Set(rows.flatMap((r: any) => r.h2.candidates.map((x: string) => { const s: any = sym.get(x); return (s?.containerName ?? "") + "." + s?.name; })))].join(","), "sites=" + rows.length + "/" + preds.length, "open=" + [...new Set(rows.map((r: any) => r.h2.openWorld))].join("/"));
  }
}
