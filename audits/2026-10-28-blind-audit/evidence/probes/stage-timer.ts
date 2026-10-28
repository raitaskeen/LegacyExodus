// Times each analysis stage separately on one generated file, to locate superlinear cost.
// Run from the worktree's legacy-exodus-core directory so its tsconfig path aliases apply.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const n = process.argv[2] ?? "1000";
const { JavaScriptParser } = await import(resolve(root, "src/parser/index.ts"));
const { JavaScriptSymbolExtractor } = await import(resolve(root, "src/symbols/index.ts"));
const { DeterministicDependencyGraphBuilder, ModuleResolver, canonicalizePath } = await import(resolve(root, "src/graph/index.ts"));
const { DeterministicCallGraphBuilder, collectUnstableExportIds } = await import(resolve(root, "src/semantic/index.ts"));
const { DeterministicControlFlowGraphBuilder, DeterministicDataFlowGraphBuilder, createProvenCallTargets } = await import(resolve(root, "src/flow/index.ts"));

const source = readFileSync(`C:/Projects/.audit/perf/n${n}/big.js`, "utf8");
const file = { id: "f", path: "big.js", language: "javascript", size: source.length };
const time = async <T>(label: string, run: () => T | Promise<T>): Promise<T> => {
  const started = performance.now();
  const result = await run();
  console.log(`  ${label.padEnd(12)} ${Math.round(performance.now() - started)} ms`);
  return result;
};
console.log(`n=${n}`);
const ast = (await time("parse", () => new JavaScriptParser().parse({ file, source }))).result;
const table = await time("symbols", () => new JavaScriptSymbolExtractor().extract(ast));
const graph = await time("dependency", () => new DeterministicDependencyGraphBuilder(new ModuleResolver()).build([table], [file]));
const tables = new Map([[canonicalizePath(table.filePath), table]]);
const imports = new Map([[canonicalizePath(table.filePath), table.symbols.filter((s: any) => s.kind === "import")]]);
const targets = new Map(graph.edges.map((e: any) => [e.importSymbolId, e.targetExportSymbolId]));
const calls: any[] = []; const refs: any[] = [];
await time("call-graph", () => new DeterministicCallGraphBuilder().buildForFile(ast, tables, imports, targets, new Set(collectUnstableExportIds(ast, table)), calls, refs));
await time("cfg", () => new DeterministicControlFlowGraphBuilder().buildAll(ast));
const proven = createProvenCallTargets(calls.filter((c) => c.resolutionState === "RESOLVED" && c.location).map((c) => ({ callId: c.id, sourceFilePath: c.sourceFilePath, location: c.location, targetSymbolId: c.targetSymbolId })));
await time("dfg", () => new DeterministicDataFlowGraphBuilder().buildContext(ast, proven, table.symbols));
console.log(`  calls=${calls.length} resolved=${calls.filter((c) => c.resolutionState === "RESOLVED").length} symbols=${table.symbols.length}`);
