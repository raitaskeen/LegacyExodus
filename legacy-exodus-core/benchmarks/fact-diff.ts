/**
 * Fact diff — compares the facts two analyses project into `.discovery/`.
 *
 * Every artifact is reduced to a set of order-independent, human-readable fact strings
 * (`category|key…`), so a candidate's semantic effect is visible as facts lost and gained
 * rather than as byte differences. Ids are rendered through the symbol table where possible.
 * Volatile fields (timestamps, run ids, durations) never enter a fact.
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

export type FactSet = ReadonlyMap<string, ReadonlySet<string>>;

export interface CategoryDiff {
  readonly category: string;
  readonly base: number;
  readonly head: number;
  readonly lost: readonly string[];
  readonly gained: readonly string[];
}

export interface FactDiff {
  readonly categories: readonly CategoryDiff[];
  readonly lost: number;
  readonly gained: number;
}

export interface CorpusDiff extends FactDiff {
  readonly corpus: string;
  readonly baseMs: number;
  readonly headMs: number;
}

/** Code-point order, independent of locale and ICU version. */
function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function readArtifact(directory: string, name: string): any {
  const path = join(directory, name);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
}

function at(location: { readonly line?: number; readonly column?: number; readonly start?: { readonly line: number; readonly column: number } } | undefined): string {
  const point = location?.start ?? location;
  return point?.line === undefined ? "@?" : `@${point.line}:${point.column ?? 0}`;
}

/** Reduces one `.discovery` directory to its facts, by category. */
export function extractFacts(discoveryDirectory: string): FactSet {
  const facts = new Map<string, Set<string>>();
  const add = (category: string, fact: string): void => {
    const set = facts.get(category) ?? new Set<string>();
    set.add(fact);
    facts.set(category, set);
  };
  const addCounted = (category: string, keys: readonly string[]): void => {
    const counts = new Map<string, number>();
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
    for (const [key, count] of counts) add(category, count === 1 ? key : `${key} ×${count}`);
  };

  const symbols: any[] = readArtifact(discoveryDirectory, "symbols.json") ?? [];
  const symbolById = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  const describe = (id: string | undefined): string => {
    if (id === undefined) return "-";
    const symbol = symbolById.get(id);
    return symbol === undefined ? `#${id.slice(0, 8)}` : `${symbol.kind}:${symbol.name}${at(symbol.location)}@${symbol.filePath}`;
  };

  for (const file of readArtifact(discoveryDirectory, "files.json") ?? []) add("files", `${file.path}|${file.language}|${file.fileKind ?? "-"}`);
  for (const file of readArtifact(discoveryDirectory, "summary.json")?.analysisDisposition?.files ?? []) {
    add("dispositions", `${file.path}|${file.kind}${file.code === undefined ? "" : `|${file.code}`}${file.secondPassFailure === undefined ? "" : `|second-pass:${file.secondPassFailure.code}`}`);
  }
  for (const framework of readArtifact(discoveryDirectory, "frameworks.json") ?? []) add("frameworks", `${framework.name}|${framework.evidence}`);
  for (const dependency of readArtifact(discoveryDirectory, "dependencies.json") ?? []) add("dependencies", `${dependency.name}|${dependency.version}|${dependency.kind}`);
  for (const symbol of symbols) {
    add("symbols", `${symbol.filePath}|${symbol.kind}|${symbol.name}${at(symbol.location)}|${symbol.exported ? "exported" : "local"}|${symbol.containerName ?? "-"}`);
  }

  const graph = readArtifact(discoveryDirectory, "dependency-graph.json");
  for (const edge of graph?.moduleGraph?.edges ?? []) add("module-edges", `${edge.sourceFilePath} -> ${edge.targetFilePath}|${edge.moduleSpecifier}|${edge.form}`);
  for (const edge of graph?.edges ?? []) add("import-edges", `${describe(edge.importSymbolId)} -> ${describe(edge.targetExportSymbolId)}`);
  for (const cycle of graph?.cycles ?? []) add("cycles", cycle.join(" > "));

  const semantic = readArtifact(discoveryDirectory, "semantic.json");
  for (const call of semantic?.calls ?? []) {
    add("calls", `${call.sourceFilePath}${at(call.location)}|${call.callerName}|${call.calleeName}|${call.resolutionState}|${describe(call.targetSymbolId)}`);
  }
  addCounted("references", (semantic?.references ?? []).map((reference: any) =>
    `${reference.filePath}|${reference.kind}|${reference.name}|${reference.resolutionState}|${describe(reference.resolvedSymbolId)}`));
  for (const kind of ["deadCode", "unusedImports", "unusedExports"] as const) {
    for (const finding of semantic?.[kind] ?? []) add(kind, `${finding.reason}|${describe(finding.symbolId)}|${finding.state}`);
  }
  for (const entry of semantic?.entryPoints ?? []) add("entryPoints", `${entry.filePath}|${entry.reason}`);
  for (const route of semantic?.routes ?? []) {
    add("routes", `${route.filePath}|${route.method} ${route.path}|handler=${route.handlerName ?? "-"}|middleware=[${(route.middleware ?? []).join(",")}]|${route.state}`);
  }
  for (const chain of semantic?.middlewareChains ?? []) add("middlewareChains", `${chain.filePath}|[${chain.middleware.join(",")}]`);

  for (const cfg of readArtifact(discoveryDirectory, "control-flow.json")?.graphs ?? []) {
    add("cfg", `${cfg.filePath}|${cfg.scopeName}|#${String(cfg.id).slice(0, 8)}|blocks=${cfg.blocks.length}|edges=${cfg.edges.length}|loops=${cfg.loops.length}|unreachable=${cfg.unreachableBlockIds.length}`);
  }
  for (const dfg of readArtifact(discoveryDirectory, "data-flow.json")?.graphs ?? []) {
    add("dfg", `${dfg.filePath}|definitions=${dfg.definitions.length}|uses=${dfg.uses.length}|interprocedural=${dfg.interproceduralFlows.length}|bindings=${dfg.callBindings.length}`);
    for (const flow of dfg.taintFlows) add("taint", `${dfg.filePath}|source=#${flow.sourceId.slice(0, 8)}|sink=#${flow.sinkId.slice(0, 8)}:${flow.path.at(-1)}|${flow.state}`);
  }

  return facts;
}

/** Facts in `base` missing from `head` are lost; facts only in `head` are gained. */
export function diffFacts(base: FactSet, head: FactSet): FactDiff {
  const categories = [...new Set([...base.keys(), ...head.keys()])].sort(compare).map((category): CategoryDiff => {
    const before = base.get(category) ?? new Set<string>();
    const after = head.get(category) ?? new Set<string>();
    return {
      category,
      base: before.size,
      head: after.size,
      lost: [...before].filter((fact) => !after.has(fact)).sort(compare),
      gained: [...after].filter((fact) => !before.has(fact)).sort(compare),
    };
  });
  return {
    categories,
    lost: categories.reduce((sum, category) => sum + category.lost.length, 0),
    gained: categories.reduce((sum, category) => sum + category.gained.length, 0),
  };
}

/** Analyzes a fresh copy of `corpus` with the engine at `engineRoot` and returns its facts. */
export function analyzeWith(engineRoot: string, corpus: string): { readonly facts: FactSet; readonly durationMs: number } {
  const work = mkdtempSync(join(tmpdir(), "lx-fact-diff-"));
  try {
    const copy = join(work, basename(resolve(corpus)));
    cpSync(resolve(corpus), copy, { recursive: true, filter: (path) => !/[\\/](\.discovery|\.git)([\\/]|$)/.test(path) });
    const run = spawnSync(process.execPath, ["run", join(engineRoot, "src/cli/index.ts"), "analyze", copy, "--refresh", "--json"], {
      cwd: engineRoot,
      encoding: "utf8",
      maxBuffer: 1 << 26,
      env: { ...process.env, LEGACY_EXODUS_HOME: join(work, "home"), NO_COLOR: "1" },
    });
    if (run.status !== 0) throw new Error(`analyze failed for ${corpus} with ${engineRoot}: ${run.stderr.slice(0, 2000)}`);
    const report = JSON.parse(run.stdout) as { readonly durationMs: number };
    return { facts: extractFacts(join(copy, ".discovery")), durationMs: report.durationMs };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Runs both engines on every corpus directory and diffs their facts. */
export function runFactDiff(baseEngine: string, headEngine: string, corpora: readonly string[]): readonly CorpusDiff[] {
  return corpora.map((corpus) => {
    const base = analyzeWith(resolve(baseEngine), corpus);
    const head = analyzeWith(resolve(headEngine), corpus);
    return { corpus, baseMs: base.durationMs, headMs: head.durationMs, ...diffFacts(base.facts, head.facts) };
  });
}

/** Markdown summary: one table row per changed category, then capped fact lists. */
export function formatFactDiff(results: readonly CorpusDiff[], limit = 50): string {
  const lines: string[] = ["# Fact diff", ""];
  for (const result of results) {
    const delta = result.baseMs === 0 ? "n/a" : `${(((result.headMs - result.baseMs) / result.baseMs) * 100).toFixed(1)}%`;
    lines.push(`## ${result.corpus}`, "", `Lost ${result.lost}, gained ${result.gained}. Engine time ${Math.round(result.baseMs)} ms -> ${Math.round(result.headMs)} ms (${delta}, single run).`, "");
    const changed = result.categories.filter((category) => category.lost.length > 0 || category.gained.length > 0);
    if (changed.length === 0) { lines.push("No fact changed.", ""); continue; }
    lines.push("| Category | Base | Head | Lost | Gained |", "|---|---|---|---|---|");
    for (const category of changed) lines.push(`| ${category.category} | ${category.base} | ${category.head} | ${category.lost.length} | ${category.gained.length} |`);
    lines.push("");
    for (const category of changed) {
      for (const [label, facts] of [["Lost", category.lost], ["Gained", category.gained]] as const) {
        if (facts.length === 0) continue;
        lines.push(`### ${label} ${category.category}`, "", ...facts.slice(0, limit).map((fact) => `- \`${fact}\``));
        if (facts.length > limit) lines.push(`- … ${facts.length - limit} more`);
        lines.push("");
      }
    }
  }
  return lines.join("\n");
}
