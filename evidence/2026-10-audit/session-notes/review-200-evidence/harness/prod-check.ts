import { readFileSync } from "node:fs";
const dir = process.argv[2]!;
const read = (n: string) => JSON.parse(readFileSync(`${dir}/.discovery/${n}`, "utf8"));
const semantic = read("semantic.json");
const symbolsDoc = read("symbols.json");
const flow = read("data-flow.json");
const symbols = (Array.isArray(symbolsDoc) ? symbolsDoc : symbolsDoc.symbols ?? symbolsDoc.tables?.flatMap((t: any) => t.symbols) ?? []);
const allSymbols = Array.isArray(symbols) && symbols[0]?.symbols ? symbols.flatMap((t: any) => t.symbols) : symbols;
const calls = semantic.calls ?? semantic.payload?.calls ?? [];
const graphs = flow.graphs ?? flow.payload?.graphs ?? flow;
const bindings = new Map<string, any>();
for (const g of graphs) for (const b of g.callBindings ?? []) bindings.set(b.callId, b);
const want = new Set(["c.m", "x.m", "this.#m", "f", "a.m", "h"]);
for (const call of calls) {
  if (!want.has(call.calleeName)) continue;
  const target = allSymbols.find((s: any) => s.id === call.targetSymbolId);
  const binding = bindings.get(call.id);
  console.log(`${call.sourceFilePath}:${call.location?.line} ${call.calleeName} ${call.resolutionState} -> ${target ? `${target.kind} ${target.containerName ?? ""}.${target.name} @${target.filePath}:${target.location?.start.line}` : "-"} | DFG callBinding: ${binding ? `target=${binding.targetSymbolId === call.targetSymbolId ? "same" : binding.targetSymbolId}` : "none"}`);
}
