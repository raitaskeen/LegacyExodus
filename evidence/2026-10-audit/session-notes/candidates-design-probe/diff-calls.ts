// Measurement probe: classify calls demoted by F-002. Usage: bun diff-calls.ts <base.json> <f002.json> [--list]
import { readFile } from "node:fs/promises";

const [baseFile, candFile, flag] = process.argv.slice(2);
const base = JSON.parse(await readFile(baseFile!, "utf8"));
const cand = JSON.parse(await readFile(candFile!, "utf8"));
const symbols = new Map<string, any>(base.symbols.map((s: any) => [s.id, s]));
const candById = new Map<string, any>(cand.calls.map((c: any) => [c.id, c]));

let changedTarget = 0, gained = 0, missing = 0;
const lost: any[] = [];
for (const call of base.calls) {
  const other = candById.get(call.id);
  if (other === undefined) { missing++; continue; }
  if (call.resolutionState === "RESOLVED" && other.resolutionState === "UNRESOLVED") lost.push(call);
  else if (call.resolutionState === "UNRESOLVED" && other.resolutionState === "RESOLVED") gained++;
  else if (call.resolutionState === "RESOLVED" && call.targetSymbolId !== other.targetSymbolId) changedTarget++;
}

function category(call: any): string {
  const target = symbols.get(call.targetSymbolId);
  const parts = String(call.calleeName).split(".");
  if (parts.length === 1) return target?.kind === "class" ? "rebound-class-binding" : target?.kind === "export" || target?.kind === "import" ? "rebound-import-binding" : `rebound-${target?.kind ?? "?"}-binding`;
  if (parts[0] === "this") return target?.containerId !== undefined ? "this-public-class-method" : "this-container-member";
  return target?.containerId !== undefined ? "receiver-class-method(new C unproven)" : "object-container-member";
}

const byCategory = new Map<string, number>();
for (const call of lost) byCategory.set(category(call), (byCategory.get(category(call)) ?? 0) + 1);
console.log(JSON.stringify({ baseResolved: base.calls.filter((c: any) => c.resolutionState === "RESOLVED").length, candResolved: cand.calls.filter((c: any) => c.resolutionState === "RESOLVED").length, lost: lost.length, gained, changedTarget, missing, byCategory: Object.fromEntries([...byCategory].sort()) }, null, 1));
if (flag === "--list") for (const call of lost) {
  const t = symbols.get(call.targetSymbolId);
  console.log(`${category(call)}\t${call.sourceFilePath}:${call.location?.line}\t${call.callerName} -> ${call.calleeName}\t=> ${t?.kind} ${t?.containerName ?? ""}.${t?.name} @${t?.filePath}:${t?.line}`);
}
