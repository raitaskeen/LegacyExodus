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
  readonly baseCoverage?: CallCoverage;
  readonly headCoverage?: CallCoverage;
}

/**
 * How many calls have a proven target, and why the others do not (Phase A2). A call without a recorded reason
 * (an engine before A1) counts under `not-recorded`.
 */
export interface CallCoverage {
  readonly calls: number;
  readonly resolved: number;
  readonly byReason: ReadonlyMap<string, number>;
}

/** Reads the calls of one `.discovery` directory into a coverage summary. */
export function measureCoverage(discoveryDirectory: string): CallCoverage {
  const calls: readonly { readonly resolutionState?: string; readonly reason?: string }[] = readArtifact(discoveryDirectory, "semantic.json")?.calls ?? [];
  const byReason = new Map<string, number>();
  let resolved = 0;
  for (const call of calls) {
    if (call.resolutionState === "RESOLVED") { resolved++; continue; }
    const reason = call.reason ?? "not-recorded";
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
  }
  return { calls: calls.length, resolved, byReason };
}

/** A count as a share of all calls, one decimal. */
function share(count: number, total: number): string {
  return total === 0 ? "0.0%" : `${((100 * count) / total).toFixed(1)}%`;
}

/** Markdown coverage table for one corpus: base and head side by side, or head alone. */
export function formatCoverage(head: CallCoverage, base?: CallCoverage): string[] {
  const rows: [string, number, number | undefined][] = [["resolved", head.resolved, base?.resolved]];
  const reasons = [...new Set([...head.byReason.keys(), ...(base?.byReason.keys() ?? [])])]
    .sort((left, right) => (head.byReason.get(right) ?? 0) - (head.byReason.get(left) ?? 0) || compare(left, right));
  for (const reason of reasons) rows.push([reason, head.byReason.get(reason) ?? 0, base === undefined ? undefined : base.byReason.get(reason) ?? 0]);
  const lines = base === undefined
    ? [`Calls: ${head.calls}.`, "", "| Calls | Count | Share |", "|---|---|---|"]
    : [`Calls: base ${base.calls}, head ${head.calls}.`, "", "| Calls | Base | Head | Share (head) |", "|---|---|---|---|"];
  for (const [label, count, baseCount] of rows) {
    lines.push(base === undefined ? `| ${label} | ${count} | ${share(count, head.calls)} |` : `| ${label} | ${baseCount ?? 0} | ${count} | ${share(count, head.calls)} |`);
  }
  return [...lines, ""];
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

function anchor(sourceAnchor: any): string {
  if (sourceAnchor?.kind === "offset") return `@${sourceAnchor.start}-${sourceAnchor.end}`;
  if (sourceAnchor?.kind === "location") return `@${sourceAnchor.start?.line}:${sourceAnchor.start?.column}`;
  return "@?";
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
    // Each occurrence is its own fact (`x`, `x #2`, …), so a count that rises is a gain and one that
    // falls loses exactly the missing occurrences; neither shows as a lost fact plus a gained one.
    for (const [key, count] of counts) for (let index = 1; index <= count; index++) add(category, index === 1 ? key : `${key} #${index}`);
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
    // Edit-stable identity (ADR-008): a key that changes or disappears is a lost identity, whatever the reason.
    if (typeof symbol.key === "string") add("symbol-keys", symbol.key);
  }
  // Every other symbol field, so flag regressions (async, default, parameters, …) are visible.
  addCounted("symbol-details", symbols.map((symbol) => [
    `${symbol.filePath}|${symbol.kind}|${symbol.name}${at(symbol.location)}${symbol.location?.end === undefined ? "" : `-${symbol.location.end.line}:${symbol.location.end.column}`}`,
    `async=${symbol.async === true}`, `default=${symbol.defaultExport === true}`, `anonymous=${symbol.anonymous === true}`,
    `visibility=${symbol.visibility ?? "-"}`, `params=[${(symbol.parameters ?? []).join(",")}]`,
    `source=${symbol.sourceSymbolName ?? "-"}`, `module=${symbol.moduleSpecifier ?? "-"}`, `declaration=${symbol.declarationKind ?? "-"}`,
    `value=${symbol.value === undefined ? "-" : JSON.stringify(symbol.value)}`, `container=${describe(symbol.containerId)}`,
  ].join("|")));

  const graph = readArtifact(discoveryDirectory, "dependency-graph.json");
  addCounted("module-edges", (graph?.moduleGraph?.edges ?? []).map((edge: any) =>
    `${edge.sourceFilePath} -> ${edge.targetFilePath}|${edge.moduleSpecifier}|${edge.form}|phase=${edge.sourcePhase ?? "-"}|${anchor(edge.sourceAnchor)}`));
  addCounted("module-unresolved", (graph?.moduleGraph?.unresolvedReferences ?? []).map((reference: any) =>
    `${reference.sourceFilePath}|${reference.form}|${anchor(reference.sourceAnchor)}`));
  addCounted("import-edges", (graph?.edges ?? []).map((edge: any) => `${describe(edge.importSymbolId)} -> ${describe(edge.targetExportSymbolId)}`));
  for (const cycle of graph?.cycles ?? []) add("cycles", cycle.join(" > "));

  const semantic = readArtifact(discoveryDirectory, "semantic.json");
  addCounted("calls", (semantic?.calls ?? []).map((call: any) =>
    `${call.sourceFilePath}${at(call.location)}|${call.callerName}|${call.calleeName}|${call.resolutionState}|${describe(call.targetSymbolId)}`));
  for (const call of semantic?.calls ?? []) if (typeof call.key === "string") add("call-keys", call.key);
  for (const route of semantic?.routes ?? []) if (typeof route.key === "string") add("route-keys", route.key);
  for (const chain of semantic?.middlewareChains ?? []) if (typeof chain.key === "string") add("middleware-keys", chain.key);
  const dataFlow = readArtifact(discoveryDirectory, "data-flow.json");
  for (const graph of dataFlow?.graphs ?? []) {
    for (const definition of graph.definitions ?? []) if (typeof definition.key === "string") add("definition-keys", definition.key);
    for (const use of graph.uses ?? []) if (typeof use.key === "string") add("use-keys", use.key);
    for (const flow of graph.taintFlows ?? []) if (typeof flow.key === "string") add("taint-keys", `${flow.key}|${flow.state}`);
  }
  for (const reference of semantic?.references ?? []) if (typeof reference.key === "string") add("reference-keys", `${reference.kind}|${reference.key}`);
  addCounted("references", (semantic?.references ?? []).map((reference: any) =>
    `${reference.filePath}|${reference.kind}|${reference.name}|${reference.resolutionState}|${describe(reference.resolvedSymbolId)}`));
  for (const kind of ["deadCode", "unusedImports", "unusedExports"] as const) {
    addCounted(kind, (semantic?.[kind] ?? []).map((finding: any) => `${finding.reason}|${describe(finding.symbolId)}|${finding.state}`));
  }
  for (const entry of semantic?.entryPoints ?? []) add("entryPoints", `${entry.filePath}|${entry.reason}`);
  addCounted("routes", (semantic?.routes ?? []).map((route: any) =>
    `${route.filePath}|${route.method} ${route.path}|handler=${route.handlerName ?? "-"}|middleware=[${(route.middleware ?? []).join(",")}]|${route.state}`));
  addCounted("middlewareChains", (semantic?.middlewareChains ?? []).map((chain: any) => `${chain.filePath}|[${(chain.middleware ?? []).join(",")}]`));
  // One fact per scope and per declared or referenced name: a name added to a scope is a gain, not a
  // lost scope plus a gained one.
  for (const scope of semantic?.scopes ?? []) {
    const owner = `${scope.filePath}|${scope.name}`;
    add("scopes", owner);
    addCounted("scope-declared", (scope.declaredSymbols ?? []).map((name: string) => `${owner}|${name}`));
    addCounted("scope-referenced", (scope.referencedNames ?? []).map((name: string) => `${owner}|${name}`));
  }

  for (const cfg of readArtifact(discoveryDirectory, "control-flow.json")?.graphs ?? []) {
    const blocks = new Map<string, any>((cfg.blocks ?? []).map((block: any) => [block.id, block]));
    // A block is named by its first statement, which is stable across engines; empty blocks by role.
    const label = (id: string): string => {
      const first = blocks.get(id)?.statements?.[0];
      return first !== undefined ? `${first.type}${at(first.location)}` : id === cfg.entryBlockId ? "entry" : id === cfg.exitBlockId ? "exit" : "empty";
    };
    add("cfg", `${cfg.filePath}|${cfg.scopeName}|#${String(cfg.id).slice(0, 8)}|blocks=${blocks.size}|edges=${(cfg.edges ?? []).length}|loops=${(cfg.loops ?? []).length}|unreachable=${(cfg.unreachableBlockIds ?? []).length}|dead=${(cfg.deadCodeNodeIds ?? []).length}|state=${cfg.state}`);
    addCounted("cfg-edges", (cfg.edges ?? []).map((edge: any) => `${cfg.filePath}|${cfg.scopeName}|${label(edge.fromBlockId)} -> ${label(edge.toBlockId)}|${edge.kind}`));
    addCounted("cfg-loops", (cfg.loops ?? []).map((loop: any) => `${cfg.filePath}|${cfg.scopeName}|header=${label(loop.headerBlockId)}|blocks=[${(loop.blockIds ?? []).map(label).sort(compare).join(",")}]`));
  }

  const dataFlowGraphs: any[] = readArtifact(discoveryDirectory, "data-flow.json")?.graphs ?? [];
  const definitionById = new Map<string, any>(dataFlowGraphs.flatMap((dfg) => (dfg.definitions ?? []).map((definition: any) => [definition.id, definition] as const)));
  const definition = (id: string | null | undefined): string => {
    if (id === undefined || id === null) return "-";
    const found = definitionById.get(id);
    return found === undefined ? `#${id.slice(0, 8)}` : `${found.name}:${found.kind}${found.constantValue === undefined ? "" : `=${JSON.stringify(found.constantValue)}`}@${found.filePath}`;
  };
  for (const dfg of dataFlowGraphs) {
    // The graph's state only: its definitions, uses, transfers and bindings are exact facts of their own below, so a
    // count here would report every added fact as one more "lost" summary line.
    add("dfg", `${dfg.filePath}|state=${dfg.state}`);
    addCounted("dfg-uses", (dfg.uses ?? []).map((use: any) => `${dfg.filePath}|${use.name} -> ${use.definitionId === undefined ? "unbound" : definition(use.definitionId)}`));
    addCounted("dfg-interprocedural", (dfg.interproceduralFlows ?? []).map((flow: any) => `${dfg.filePath}|${flow.kind}|${definition(flow.sourceDefinitionId)} -> ${definition(flow.targetDefinitionId)}`));
    addCounted("dfg-bindings", (dfg.callBindings ?? []).map((binding: any) =>
      `${dfg.filePath}|-> ${describe(binding.targetSymbolId)}|args=[${(binding.argumentDefinitionIds ?? []).map(definition).join(",")}]|receiver=${definition(binding.receiverDefinitionId)}${binding.argumentSourceIds === undefined ? "" : `|sources=[${binding.argumentSourceIds.map((id: string | null) => (id === null || id === undefined ? "-" : `#${id.slice(0, 8)}`)).join(",")}]`}`));
    addCounted("dfg-summaries", (dfg.functionSummaries ?? []).map((summary: any) =>
      `${summary.filePath}|${describe(summary.symbolId)}|params=[${(summary.parameterDefinitionIds ?? []).map((slot: any) => (Array.isArray(slot) ? slot : [slot]).map(definition).join("&")).join(",")}]|returns=${(summary.returnDefinitionIds ?? []).length}`));
    addCounted("taint", (dfg.taintFlows ?? []).map((flow: any) =>
      `${dfg.filePath}|source=#${flow.sourceId.slice(0, 8)}|via=[${(flow.path ?? []).slice(1, -1).map(definition).join(" > ")}]|sink=#${flow.sinkId.slice(0, 8)}:${(flow.path ?? []).at(-1)}|${flow.state}`));
  }

  const knowledge = readArtifact(discoveryDirectory, "knowledge.json");
  const node = (id: string): string => (id.startsWith("symbol:") ? describe(id.slice("symbol:".length)) : id);
  addCounted("knowledge", [
    ...(knowledge?.nodes ?? []).map((entry: any) => `node|${entry.kind}|${node(entry.id)}`),
    ...(knowledge?.edges ?? []).map((edge: any) => `edge|${edge.relationship}|${node(edge.from)} -> ${node(edge.to)}`),
  ]);

  const summary = readArtifact(discoveryDirectory, "summary.json");
  if (summary !== undefined) {
    add("summary", `files=${summary.fileCount}|dependencies=${summary.dependencyCount}|frameworks=${summary.frameworkCount}|enumerationFailures=${summary.enumerationFailureCount}|manifestFailures=${summary.manifestFailureCount ?? "-"}|discoveryComplete=${summary.discoveryComplete}`);
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
export function analyzeWith(engineRoot: string, corpus: string): { readonly facts: FactSet; readonly durationMs: number; readonly coverage: CallCoverage } {
  const cli = join(engineRoot, "src/cli/index.ts");
  if (!existsSync(cli)) throw new Error(`Not an engine root (missing ${cli}): ${engineRoot}`);
  const work = mkdtempSync(join(tmpdir(), "lx-fact-diff-"));
  try {
    const copy = join(work, basename(resolve(corpus)));
    cpSync(resolve(corpus), copy, { recursive: true, filter: (path) => !/[\\/](\.discovery|\.git)([\\/]|$)/.test(path) });
    const run = spawnSync(process.execPath, ["run", cli, "analyze", copy, "--refresh", "--json"], {
      cwd: engineRoot,
      encoding: "utf8",
      maxBuffer: 1 << 26,
      env: { ...process.env, LEGACY_EXODUS_HOME: join(work, "home"), NO_COLOR: "1" },
    });
    if (run.status !== 0) throw new Error(`analyze failed for ${corpus} with ${engineRoot}: ${String(run.stderr ?? run.error ?? "").slice(0, 2000)}`);
    const report = JSON.parse(run.stdout) as { readonly durationMs: number };
    // No projection means no evidence; reporting "no change" for it would hide a broken engine.
    if (!existsSync(join(copy, ".discovery", "manifest.json"))) throw new Error(`analyze wrote no .discovery/manifest.json for ${corpus} with ${engineRoot}`);
    return { facts: extractFacts(join(copy, ".discovery")), durationMs: report.durationMs, coverage: measureCoverage(join(copy, ".discovery")) };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Runs both engines on every corpus directory and diffs their facts. */
export function runFactDiff(baseEngine: string, headEngine: string, corpora: readonly string[]): readonly CorpusDiff[] {
  return corpora.map((corpus) => {
    const base = analyzeWith(resolve(baseEngine), corpus);
    const head = analyzeWith(resolve(headEngine), corpus);
    return { corpus, baseMs: base.durationMs, headMs: head.durationMs, baseCoverage: base.coverage, headCoverage: head.coverage, ...diffFacts(base.facts, head.facts) };
  });
}

/** Markdown summary: one table row per changed category, then capped fact lists. */
export function formatFactDiff(results: readonly CorpusDiff[], limit = 50): string {
  const lines: string[] = ["# Fact diff", ""];
  for (const result of results) {
    const delta = result.baseMs === 0 ? "n/a" : `${(((result.headMs - result.baseMs) / result.baseMs) * 100).toFixed(1)}%`;
    lines.push(`## ${result.corpus}`, "", `Lost ${result.lost}, gained ${result.gained}. Engine time ${Math.round(result.baseMs)} ms -> ${Math.round(result.headMs)} ms (${delta}, single run).`, "");
    if (result.headCoverage !== undefined) lines.push(...formatCoverage(result.headCoverage, result.baseCoverage));
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
