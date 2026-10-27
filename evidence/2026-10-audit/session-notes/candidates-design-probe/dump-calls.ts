// Measurement probe (scratch only, not product code). Replicates the command-handler
// analysis pipeline up to the call graph for one engine checkout and one corpus, and
// writes calls plus a symbol index as JSON. Usage:
//   bun dump-calls.ts <engineRoot(legacy-exodus-core)> <corpusPath> <out.json>
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [engineRoot, corpusPath, outFile] = process.argv.slice(2);
if (!engineRoot || !corpusPath || !outFile) throw new Error("usage: <engineRoot> <corpusPath> <out.json>");
const src = (path: string) => resolve(engineRoot, "src", path);

const { DiscoveryEngine } = await import(src("discovery/index.ts"));
const { JavaScriptParser, ParserManager, ParserRegistry } = await import(src("parser/index.ts"));
const { JavaScriptSymbolExtractor } = await import(src("symbols/index.ts"));
const { DeterministicDependencyGraphBuilder, ModuleResolver, canonicalizePath } = await import(src("graph/index.ts"));
const { DeterministicCallGraphBuilder } = await import(src("semantic/call-graph-builder.ts"));

async function readPathAliases(projectPath: string): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await readFile(resolve(projectPath, "tsconfig.json"), "utf8"));
    const options = parsed?.compilerOptions ?? {};
    const paths = typeof options.paths === "object" && options.paths !== null
      ? Object.fromEntries(Object.entries(options.paths).flatMap(([key, targets]) => Array.isArray(targets) && targets.every((t) => typeof t === "string") ? [[key, Object.freeze([...targets].sort())]] : []))
      : undefined;
    return { ...(typeof options.baseUrl === "string" ? { baseUrl: options.baseUrl } : {}), ...(paths === undefined ? {} : { paths }) };
  } catch { return {}; }
}

const projectPath = resolve(corpusPath);
const discovery = await new DiscoveryEngine().discover({ projectId: "00000000-0000-4000-8000-000000000001", projectPath });
const registry = new ParserRegistry();
registry.register(new JavaScriptParser());
const parserManager = new ParserManager(registry);
const extractor = new JavaScriptSymbolExtractor();

const asts: unknown[] = [];
const tables: { filePath: string; symbols: Record<string, unknown>[] }[] = [];
const parsedFiles: { id: string; path: string }[] = [];
let parseFailures = 0;
for (const file of discovery.files) {
  if (file.language !== "javascript" && file.language !== "typescript") continue;
  try {
    const ast = await parserManager.parse({ file, source: await readFile(resolve(projectPath, file.path), "utf8") });
    if (ast.errors.length > 0) { parseFailures++; continue; }
    const table = extractor.extract(ast);
    asts.push(ast);
    tables.push(table);
    parsedFiles.push(file);
  } catch { parseFailures++; }
}

const dependencyGraph = new DeterministicDependencyGraphBuilder(new ModuleResolver(await readPathAliases(projectPath))).build(tables, discovery.files);
const tablesByPath = new Map(tables.map((table) => [canonicalizePath(table.filePath), table]));
const importsByFile = new Map(tables.map((table) => [canonicalizePath(table.filePath), table.symbols.filter((s) => s.kind === "import")]));
const targetByImportId = new Map(dependencyGraph.edges.map((edge: { importSymbolId: string; targetExportSymbolId: string }) => [edge.importSymbolId, edge.targetExportSymbolId]));
const builder = new DeterministicCallGraphBuilder();
const calls: Record<string, unknown>[] = [];
const references: unknown[] = [];
// Same per-file order and API as command-handler pass 2.
const order = [...asts].sort((a: any, b: any) => a.metadata.sourcePath.localeCompare(b.metadata.sourcePath));
for (const ast of order) builder.buildForFile(ast, tablesByPath, importsByFile, targetByImportId, calls, references);

const symbols = tables.flatMap((table) => table.symbols.map((s: any) => ({
  id: s.id, kind: s.kind, name: s.name, filePath: s.filePath, exported: s.exported,
  containerName: s.containerName, containerId: s.containerId, scopeId: s.scopeId, declarationKind: s.declarationKind,
  line: s.location?.start.line,
})));
const { DeterministicSemanticAnalysisEngine } = await import(src("semantic/semantic-engine.ts"));
const semantic = new DeterministicSemanticAnalysisEngine(builder).synthesize({ calls, references: references as any, symbolTables: tables as any, dependencyGraph, filePaths: parsedFiles.map((f) => f.path), httpCalls: [] });
const deadCode = semantic.deadCode.map((f: any) => f.symbolId);
await writeFile(outFile, JSON.stringify({ engineRoot, projectPath, files: parsedFiles.length, parseFailures, calls, symbols, deadCode, depEdges: dependencyGraph.edges.length }));
console.log(JSON.stringify({ files: parsedFiles.length, parseFailures, calls: calls.length, resolved: calls.filter((c) => c.resolutionState === "RESOLVED").length }));
