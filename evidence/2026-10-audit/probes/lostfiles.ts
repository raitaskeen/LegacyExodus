// Lists calls RESOLVED in <before> but not in <after> (semantic.json files), the reverse, and retargets.
import { readFileSync } from "node:fs";

const [before, after] = process.argv.slice(2) as [string, string];
const load = (path: string) => JSON.parse(readFileSync(path, "utf8")).calls as any[];
const beforeById = new Map(load(before).map((call) => [call.id, call]));
const afterById = new Map(load(after).map((call) => [call.id, call]));
const label = (call: any) => `${call.sourceFilePath}:${call.location?.line} ${call.calleeName}`;
for (const call of beforeById.values()) {
  if (call.resolutionState === "RESOLVED" && afterById.get(call.id)?.resolutionState !== "RESOLVED") console.log(`lost ${label(call)}`);
}
for (const call of afterById.values()) {
  const previous = beforeById.get(call.id);
  if (call.resolutionState === "RESOLVED" && previous?.resolutionState !== "RESOLVED") console.log(`gained ${label(call)}`);
  else if (call.resolutionState === "RESOLVED" && previous?.targetSymbolId !== call.targetSymbolId) console.log(`retargeted ${label(call)}`);
}
