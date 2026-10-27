import { readFileSync } from "node:fs";
for (const c of ["express", "fastify", "self"]) {
  const b = JSON.parse(readFileSync(`base-${c}.json`, "utf8")); const f = JSON.parse(readFileSync(`f002-${c}.json`, "utf8"));
  const est = JSON.parse(readFileSync(`estimate-${c}.json`, "utf8"));
  const cands = new Set<string>(est.rows.flatMap((r: any) => r.h2?.candidates ?? []));
  const baseDead = new Set<string>(b.deadCode); const newDead = f.deadCode.filter((x: string) => !baseDead.has(x));
  const healed = newDead.filter((x: string) => cands.has(x));
  const extraHealed = f.deadCode.filter((x: string) => baseDead.has(x) && cands.has(x));
  console.log(JSON.stringify({ corpus: c, baseDead: baseDead.size, f002Dead: f.deadCode.length, newlyDeadByF002: newDead.length, candidatesWouldCountAsPossibleRef: healed.length, alsoBaselineDeadNowPossibleRef: extraHealed.length }));
}
