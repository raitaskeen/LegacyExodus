// usage: bun peek-symbols.ts <core root> <name> <source>
import { join } from "node:path";
const [root, name, source] = process.argv.slice(2) as [string, string, string];
const { JavaScriptParser } = await import(join(root, "src/parser/index.ts"));
const { JavaScriptSymbolExtractor } = await import(join(root, "src/symbols/index.ts"));
const file = { id: "main.js", path: "main.js", language: "javascript", size: source.length };
const ast = (await new JavaScriptParser().parse({ file, source })).result;
for (const s of new JavaScriptSymbolExtractor().extract(ast).symbols.filter((s: any) => s.name === name)) {
  console.log(JSON.stringify({ kind: s.kind, scopeId: s.scopeId, exported: s.exported, defaultExport: s.defaultExport, containerName: s.containerName, loc: `${s.location?.start.line}:${s.location?.start.column}` }));
}
