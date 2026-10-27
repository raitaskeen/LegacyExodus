// usage: bun compare-calls.ts <before semantic.json> <after semantic.json>
import { readFileSync } from "node:fs";
const [beforePath, afterPath] = process.argv.slice(2) as [string, string];
type Call = { id: string; calleeName: string; sourceFilePath: string; resolutionState: string; targetSymbolId?: string; location?: { line: number } };
const load = (path: string) => (JSON.parse(readFileSync(path, "utf8")).calls as Call[]);
const before = new Map(load(beforePath).map((call) => [call.id, call]));
const after = new Map(load(afterPath).map((call) => [call.id, call]));
const resolved = (call?: Call) => call?.resolutionState === "RESOLVED";
const lost = [...before.values()].filter((call) => resolved(call) && !resolved(after.get(call.id)));
const gained = [...after.values()].filter((call) => resolved(call) && !resolved(before.get(call.id)));
const retargeted = [...after.values()].filter((call) => resolved(call) && resolved(before.get(call.id)) && before.get(call.id)!.targetSymbolId !== call.targetSymbolId);
console.log(JSON.stringify({ resolvedBefore: [...before.values()].filter(resolved).length, resolvedAfter: [...after.values()].filter(resolved).length, lost: lost.length, gained: gained.length, retargeted: retargeted.length }));
for (const call of lost) console.log(`LOST ${call.sourceFilePath}:${call.location?.line} ${call.calleeName}`);
for (const call of gained) console.log(`GAINED ${call.sourceFilePath}:${call.location?.line} ${call.calleeName}`);
for (const call of retargeted) console.log(`RETARGETED ${call.sourceFilePath}:${call.location?.line} ${call.calleeName}`);
