// Quantifies resolution and INFERRED-finding volume on the engine's own source corpus.
import { readFileSync } from "node:fs";

const dir = process.argv[2] ?? "C:/Projects/.audit/corpus/engine-src/.discovery";
const semantic = JSON.parse(readFileSync(`${dir}/semantic.json`, "utf8"));
const graph = JSON.parse(readFileSync(`${dir}/dependency-graph.json`, "utf8"));
const symbols = JSON.parse(readFileSync(`${dir}/symbols.json`, "utf8"));
const calls = semantic.calls as any[];
const resolved = calls.filter((call) => call.resolutionState === "RESOLVED").length;
const imports = symbols.filter((symbol: any) => symbol.kind === "import");
const relativeImports = imports.filter((symbol: any) => String(symbol.moduleSpecifier).startsWith(".") || String(symbol.moduleSpecifier).startsWith("@"));
const edgeImportIds = new Set(graph.edges.map((edge: any) => edge.importSymbolId));
const deadByKind: Record<string, number> = {};
const byId = new Map(symbols.map((symbol: any) => [symbol.id, symbol]));
for (const finding of semantic.deadCode) { const kind = (byId.get(finding.symbolId) as any)?.kind ?? "?"; deadByKind[kind] = (deadByKind[kind] ?? 0) + 1; }
console.log(JSON.stringify({
  calls: calls.length, resolvedCalls: resolved, resolvedPct: Math.round((resolved / calls.length) * 1000) / 10,
  imports: imports.length, aliasOrRelativeImports: relativeImports.length,
  importsWithExportEdge: imports.filter((symbol: any) => edgeImportIds.has(symbol.id)).length,
  moduleEdges: graph.moduleGraph.edges.length,
  deadCodeFindings: semantic.deadCode.length, deadByKind,
  unusedImports: semantic.unusedImports.length, unusedExports: semantic.unusedExports.length,
  symbols: symbols.length,
}, null, 1));
