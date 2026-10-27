// Differential probe harness (review of PR #200, independent of the author's probes).
//
// For every probe directory: analyze all .js/.ts/.mjs/.cjs files with the same pipeline the
// regression suite uses (parser -> symbol extractor -> dependency graph -> semantic engine),
// then execute the entry file with bun and compare.
//
// Protocol inside probe programs:
//   - every function whose identity matters prints `L:<label>` as its first statement, and its
//     label appears on the same source line as the function's symbol location;
//   - every call site under test is preceded on the same line by console.log("S:<site>").
// The function that ran for a site is the first `L:` line printed after `S:<site>`.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const CORE = process.env.CORE_DIR ?? "C:/Users/Grace Computers/Projects/LegacyExodus/.claude/worktrees/review-200-efbe81/legacy-exodus-core";
const { DeterministicDependencyGraphBuilder } = await import(`${CORE}/src/graph/index.ts`);
const { JavaScriptParser } = await import(`${CORE}/src/parser/index.ts`);
const { DeterministicSemanticAnalysisEngine } = await import(`${CORE}/src/semantic/index.ts`);
const { JavaScriptSymbolExtractor } = await import(`${CORE}/src/symbols/index.ts`);

const parser = new JavaScriptParser();
const extractor = new JavaScriptSymbolExtractor();

function listFiles(dir: string, root = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, root));
    else if (/\.(js|mjs|cjs|ts)$/.test(name)) out.push(relative(root, full).replace(/\\/g, "/"));
  }
  return out.sort();
}

async function analyze(dir: string) {
  const paths = listFiles(dir);
  const sources: Record<string, string> = Object.fromEntries(paths.map((p) => [p, readFileSync(join(dir, p), "utf8")]));
  const artifacts = paths.map((path) => ({ id: path, path, language: path.endsWith(".ts") ? "typescript" : "javascript", size: sources[path]!.length }));
  const asts = await Promise.all(artifacts.map(async (file) => (await parser.parse({ file, source: sources[file.path]! })).result!));
  const tables = asts.map((ast: any) => extractor.extract(ast));
  const dependencyGraph = new DeterministicDependencyGraphBuilder().build(tables, artifacts);
  const analysis = new DeterministicSemanticAnalysisEngine().analyze({ astResults: asts, dependencyGraph, symbolTables: tables });
  return { sources, analysis, symbols: tables.flatMap((t: any) => t.symbols) };
}

function labelsOnLine(source: string | undefined, line: number | undefined): string[] {
  if (source === undefined || line === undefined) return [];
  const text = source.split(/\r?\n/)[line - 1] ?? "";
  return [...text.matchAll(/"L:([^"]+)"/g)].map((m) => m[1]!);
}

function runtimeHits(stdout: string): Map<string, string[]> {
  const hits = new Map<string, string[]>();
  let site: string | undefined;
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("S:")) {
      site = line.slice(2);
      hits.set(site, [...(hits.get(site) ?? []), "<none>"]);
    } else if (line.startsWith("L:") && site !== undefined) {
      const list = hits.get(site)!;
      if (list[list.length - 1] === "<none>") list[list.length - 1] = line.slice(2);
      site = undefined;
    }
  }
  return hits;
}

const dirs = process.argv.slice(2);
let mismatches = 0;
for (const dir of dirs) {
  const name = dir.replace(/\\/g, "/").split("/").filter(Boolean).at(-1);
  const { sources, analysis, symbols } = await analyze(dir);
  const entry = readFileSync(join(dir, "ENTRY"), "utf8").trim();
  const proc = Bun.spawnSync(["bun", entry], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString().trim();
  const hits = runtimeHits(stdout);
  console.log(`\n=== ${name} (exit ${proc.exitCode}${stderr ? `, stderr: ${stderr.split(/\r?\n/).slice(0, 2).join(" | ")}` : ""})`);
  for (const [file, source] of Object.entries(sources)) {
    source.split(/\r?\n/).forEach((text, index) => {
      const marker = text.match(/console\.log\("S:([^"]+)"\)/);
      if (marker === null) return;
      const site = marker[1]!;
      const calls = analysis.calls.filter((c: any) => c.sourceFilePath === file && c.location?.line === index + 1 && !c.calleeName.startsWith("console."));
      const observed = hits.get(site) ?? [];
      for (const call of calls) {
        let claim = "-";
        let verdict = call.resolutionState;
        if (call.resolutionState === "RESOLVED") {
          const target = symbols.find((s: any) => s.id === call.targetSymbolId);
          const labels = labelsOnLine(sources[target?.filePath], target?.location?.start.line);
          claim = labels.length === 1 ? labels[0]! : `?{${target?.kind} ${target?.containerName ?? ""}.${target?.name} ${target?.filePath}:${target?.location?.start.line} labels=${labels.join(",")}}`;
          const ran = [...new Set(observed)];
          if (ran.length === 0) verdict = "RESOLVED (site not executed)";
          else if (ran.every((label) => label === claim)) verdict = "RESOLVED ok";
          else { verdict = "RESOLVED **MISMATCH**"; mismatches++; }
        }
        console.log(`  ${site.padEnd(14)} ${call.calleeName.padEnd(22)} ${verdict.padEnd(28)} claim=${claim.padEnd(18)} ran=${[...new Set(observed)].join(",") || "-"}`);
      }
      if (calls.length === 0) console.log(`  ${site.padEnd(14)} (no engine call on line ${index + 1})`);
    });
  }
}
console.log(`\nTOTAL MISMATCHES: ${mismatches}`);
