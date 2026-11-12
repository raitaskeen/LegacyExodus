// Prints the facts each sample was built to test, straight from the projected artifacts.
import { readFileSync } from "node:fs";

const base = "C:/Projects/.audit/samples";
const read = (sample: string, file: string): any => JSON.parse(readFileSync(`${base}/${sample}.out/${file}`, "utf8"));
const short = (id: string | undefined): string => (id ?? "-").slice(0, 8);
const section = (title: string): void => console.log(`\n=== ${title}`);

function symbolsOf(sample: string): any[] { return read(sample, "symbols.json"); }
function nameOf(sample: string, id: string | undefined): string {
  const symbol = symbolsOf(sample).find((candidate) => candidate.id === id);
  return symbol === undefined ? short(id) : `${symbol.kind}:${symbol.name}@${symbol.filePath}`;
}

section("s02 TS declarations: symbols, edges, unused imports");
for (const symbol of symbolsOf("s02-ts-symbols")) console.log(` ${symbol.filePath} ${symbol.kind} ${symbol.name}${symbol.exported ? " (exported)" : ""}`);
const s02graph = read("s02-ts-symbols", "dependency-graph.json");
console.log(" import->export edges:", s02graph.edges.map((edge: any) => `${nameOf("s02-ts-symbols", edge.importSymbolId)} -> ${nameOf("s02-ts-symbols", edge.targetExportSymbolId)}`));
console.log(" module edges:", s02graph.moduleGraph.edges.map((edge: any) => `${edge.sourceFilePath} -> ${edge.targetFilePath} (${edge.moduleSpecifier})`));
console.log(" unusedImports:", read("s02-ts-symbols", "semantic.json").unusedImports.map((f: any) => `${f.filePath}:${f.name}`));

section("s03 TS resolution: module edges");
for (const edge of read("s03-ts-resolution", "dependency-graph.json").moduleGraph.edges) console.log(` ${edge.sourceFilePath} -> ${edge.targetFilePath} (${edge.moduleSpecifier})`);
console.log(" calls:", read("s03-ts-resolution", "semantic.json").calls.map((c: any) => `${c.sourceFilePath}:${c.calleeName}=${c.resolutionState}`));

section("s04 JSX: references, unused imports, dead code");
const s04 = read("s04-jsx", "semantic.json");
console.log(" references:", s04.references.map((r: any) => `${r.filePath}:${r.kind}:${r.name}=${r.resolutionState}`));
console.log(" unusedImports:", s04.unusedImports.map((f: any) => `${f.filePath}:${f.name}`));
console.log(" unusedExports:", s04.unusedExports.map((f: any) => `${f.filePath}:${f.name}`));
console.log(" deadCode:", s04.deadCode.map((f: any) => `${f.filePath}:${f.name}`));

section("s05 Express routes and middleware");
const s05 = read("s05-express-routes", "semantic.json");
for (const route of s05.routes) console.log(` ${route.method} ${route.path} handler=${route.handlerName ?? "-"} middleware=[${route.middleware.join(",")}] state=${route.state}`);
console.log(" chains:", JSON.stringify(s05.middlewareChains));
console.log(" entryPoints:", JSON.stringify(s05.entryPoints));

section("s06 taint flows (per sink line)");
const s06 = read("s06-taint", "data-flow.json");
for (const graph of s06.graphs) for (const flow of graph.taintFlows) console.log(` ${flow.state} path=${flow.path.length} sink=${flow.path.at(-1)}`);
console.log(" total flows:", s06.graphs.reduce((n: number, g: any) => n + g.taintFlows.length, 0));

section("s07 namespace import edge");
for (const edge of read("s07-namespace-import", "dependency-graph.json").edges) console.log(` ${nameOf("s07-namespace-import", edge.importSymbolId)} -> ${nameOf("s07-namespace-import", edge.targetExportSymbolId)}`);
const s07 = read("s07-namespace-import", "semantic.json");
console.log(" calls:", s07.calls.map((c: any) => `${c.calleeName}=${c.resolutionState}->${nameOf("s07-namespace-import", c.targetSymbolId)}`));
console.log(" unusedExports:", s07.unusedExports.map((f: any) => `${f.filePath}:${f.name}`));

section("s08 class expression methods");
for (const symbol of symbolsOf("s08-class-expression")) console.log(` ${symbol.kind} ${symbol.name} container=${symbol.containerName ?? "-"}`);

section("s09 dynamic import / computed require");
for (const edge of read("s09-dynamic-import", "dependency-graph.json").moduleGraph.edges) console.log(` ${edge.sourceFilePath} -> ${edge.targetFilePath} (${edge.form})`);
console.log(" unusedExports:", read("s09-dynamic-import", "semantic.json").unusedExports.map((f: any) => `${f.filePath}:${f.name}`));

section("s10 file order in files.json");
console.log(" ", read("s10-order", "files.json").map((f: any) => f.path).join(" | "));
console.log("  codepoint order:", read("s10-order", "files.json").map((f: any) => f.path).sort().join(" | "));

section("s11 TS-compiled CommonJS");
for (const symbol of symbolsOf("s11-ts-compiled-cjs")) console.log(` ${symbol.filePath} ${symbol.kind} ${symbol.name}`);
console.log(" calls:", read("s11-ts-compiled-cjs", "semantic.json").calls.map((c: any) => `${c.calleeName}=${c.resolutionState}`));

section("s12 .d.ts ambient declarations");
for (const symbol of symbolsOf("s12-dts")) console.log(` ${symbol.filePath} ${symbol.kind} ${symbol.name}${symbol.exported ? " (exported)" : ""}`);
console.log(" deadCode:", read("s12-dts", "semantic.json").deadCode.map((f: any) => `${f.filePath}:${f.name}`));
