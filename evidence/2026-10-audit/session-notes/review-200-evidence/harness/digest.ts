// Builds the call graph for every .js/.ts file under a corpus directory (same pipeline as the
// regression suite) and prints a digest of the calls, the RESOLVED count and the build time.
// Usage: CORE_DIR=<legacy-exodus-core> bun digest.ts <corpus-dir>
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const CORE = process.env.CORE_DIR!;
const { DeterministicDependencyGraphBuilder } = await import(`${CORE}/src/graph/index.ts`);
const { JavaScriptParser } = await import(`${CORE}/src/parser/index.ts`);
const { DeterministicSemanticAnalysisEngine } = await import(`${CORE}/src/semantic/index.ts`);
const { JavaScriptSymbolExtractor } = await import(`${CORE}/src/symbols/index.ts`);

const root = process.argv[2]!;
const skip = new Set(["node_modules", ".git", ".discovery", "coverage", "test", "tests", "benchmarks", "examples"]);
function list(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return skip.has(name) ? [] : list(full);
    return /\.(js|ts)$/.test(name) && !name.endsWith(".d.ts") ? [relative(root, full).replace(/\\/g, "/")] : [];
  }).sort();
}
const paths = list(root);
const parser = new JavaScriptParser();
const extractor = new JavaScriptSymbolExtractor();
const artifacts = paths.map((path) => ({ id: path, path, language: path.endsWith(".ts") ? "typescript" : "javascript", size: 0 }));
const asts = [];
for (const file of artifacts) asts.push((await parser.parse({ file, source: readFileSync(join(root, file.path), "utf8") })).result!);
const tables = asts.map((ast: any) => extractor.extract(ast));
const graph = new DeterministicDependencyGraphBuilder().build(tables, artifacts);
const started = performance.now();
const analysis = new DeterministicSemanticAnalysisEngine().analyze({ astResults: asts, dependencyGraph: graph, symbolTables: tables });
const elapsed = performance.now() - started;
const calls = analysis.calls.map((c: any) => `${c.sourceFilePath}|${c.location?.line}:${c.location?.column}|${c.calleeName}|${c.resolutionState}|${c.targetSymbolId ?? ""}`).sort();
const digest = createHash("sha256").update(calls.join("\n")).digest("hex").slice(0, 16);
const resolved = analysis.calls.filter((c: any) => c.resolutionState === "RESOLVED").length;
console.log(JSON.stringify({ files: paths.length, calls: calls.length, resolved, digest, analyzeMs: Math.round(elapsed), rssMB: Math.round(process.memoryUsage().rss / 1e6) }));
