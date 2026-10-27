// Differential soundness probe: static resolution (base vs candidate) vs the target that actually runs.
// usage: bun probe-f002.ts <legacy-exodus-core root> [caseFilter]
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import { cases } from "./cases-f002";

const root = process.argv[2]!;
const only = process.argv[3];
const { DeterministicDependencyGraphBuilder } = await import(join(root, "src/graph/index.ts"));
const { JavaScriptParser } = await import(join(root, "src/parser/index.ts"));
const { DeterministicSemanticAnalysisEngine } = await import(join(root, "src/semantic/index.ts"));
const { JavaScriptSymbolExtractor } = await import(join(root, "src/symbols/index.ts"));
const parser = new JavaScriptParser();
const extractor = new JavaScriptSymbolExtractor();

async function analyze(files: Record<string, string>) {
  const artifacts = Object.entries(files).map(([path, source]) => ({ id: path, path, language: "javascript", size: source.length }));
  const asts = await Promise.all(artifacts.map(async (file) => (await parser.parse({ file, source: files[file.path]! })).result!));
  const tables = asts.map((ast: unknown) => extractor.extract(ast));
  const dependencyGraph = new DeterministicDependencyGraphBuilder().build(tables, artifacts);
  const analysis = new DeterministicSemanticAnalysisEngine().analyze({ astResults: asts, dependencyGraph, symbolTables: tables });
  return { analysis, symbols: tables.flatMap((table: { symbols: unknown[] }) => table.symbols) as any[] };
}

async function runtime(files: Record<string, string>, entry: string, esm: boolean): Promise<string[]> {
  if (!esm) {
    const seen: string[] = [];
    runInNewContext(files[entry]!, { __seen: seen });
    return seen;
  }
  const dir = mkdtempSync(join(tmpdir(), "f002-probe-"));
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), source);
  }
  writeFileSync(join(dir, "package.json"), JSON.stringify({ type: esm === true ? "module" : "commonjs" }));
  const run = Bun.spawnSync(["bun", "-e", `globalThis.__seen=[];await import(${JSON.stringify(join(dir, entry))});console.log(JSON.stringify(globalThis.__seen))`]);
  const out = run.stdout.toString().trim();
  return out.length > 0 ? JSON.parse(out) : [`<error ${run.stderr.toString().split("\n")[0]}>`];
}

for (const probe of cases) {
  if (only !== undefined && !probe.name.includes(only)) continue;
  const { analysis, symbols } = await analyze(probe.files);
  const calls = analysis.calls.filter((call: any) => call.calleeName === probe.callee && call.sourceFilePath === probe.entry);
  const shown = calls.map((call: any) => {
    const target = symbols.find((symbol) => symbol.id === call.targetSymbolId);
    const label = target === undefined ? "" : ` -> ${target.containerName ?? target.filePath}.${target.name}[${target.kind}]`;
    return `${call.resolutionState}${label}`;
  });
  const ran = await runtime(probe.files, probe.entry, probe.esm ?? false);
  console.log(`${probe.name.padEnd(34)} static=${shown.join(" | ") || "<no call>"}  runtime=${JSON.stringify(ran)}`);
}
