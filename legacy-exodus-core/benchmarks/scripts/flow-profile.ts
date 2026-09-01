/**
 * Phase 3A — Deep Flow & DFG Sub-stage Profiler
 *
 * Measures the exact microsecond/millisecond breakdown of:
 * - CFG Construction
 * - DFG AST Walk & Definition/Use Extraction
 * - DFG Def-Use Chain Matching (the O(D * U) loop)
 * - DFG Lifetime Construction (the second O(D * U) loop)
 * - Interprocedural Transfer Mapping
 * - Taint Fixpoint Iteration Loop
 */

import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { DiscoveryEngine } from "@discovery/index";
import { JavaScriptParser, ParserManager, ParserRegistry } from "@parser/index";
import { JavaScriptSymbolExtractor, type SymbolTable } from "@symbols/index";
import { DeterministicDependencyGraphBuilder, ModuleResolver } from "@graph/index";
import { DeterministicSemanticAnalysisEngine } from "@semantic/index";
import { DeterministicControlFlowGraphBuilder } from "@flow/control-flow-builder";
import { DeterministicDataFlowGraphBuilder } from "@flow/data-flow-builder";
import { createProvenCallTargets } from "@flow/flow-contracts";

export async function profileFlowSubstages(targetPath: string): Promise<void> {
  const absPath = resolve(targetPath);
  const targetName = basename(absPath);

  console.log(`\n======================================================`);
  console.log(` DEEP FLOW PROFILING: ${targetName} (${absPath})`);
  console.log(`======================================================\n`);

  // Discovery + Parser + Symbols + DepGraph + Semantics
  const discovery = await new DiscoveryEngine().discover({
    projectId: "00000000-0000-4000-8000-000000000001",
    projectPath: absPath,
  });

  const parserRegistry = new ParserRegistry();
  parserRegistry.register(new JavaScriptParser());
  const parserManager = new ParserManager(parserRegistry);
  const symbolExtractor = new JavaScriptSymbolExtractor();
  const sourceFiles = discovery.files.filter((f) => f.language === "javascript" || f.language === "typescript");

  const astResults = [];
  const symbolTables: SymbolTable[] = [];

  for (const file of sourceFiles) {
    let source: string;
    try { source = await readFile(resolve(absPath, file.path), "utf8"); } catch { continue; }
    try {
      const ast = await parserManager.parse({ file, source });
      if (ast.errors.length === 0) {
        astResults.push(ast);
        symbolTables.push(symbolExtractor.extract(ast));
      }
    } catch {}
  }

  let pathAliases = {};
  try {
    const tsconfig = JSON.parse(await readFile(resolve(absPath, "tsconfig.json"), "utf8"));
    if (tsconfig?.compilerOptions?.paths) pathAliases = { paths: tsconfig.compilerOptions.paths, baseUrl: tsconfig.compilerOptions.baseUrl };
  } catch {}
  const depGraph = new DeterministicDependencyGraphBuilder(new ModuleResolver(pathAliases)).build(symbolTables, discovery.files);
  const semantic = new DeterministicSemanticAnalysisEngine().analyze({ astResults, dependencyGraph: depGraph, symbolTables });

  console.log(`Pre-flow Setup complete: ${astResults.length} files parsed, ${symbolTables.reduce((a, t) => a + t.symbols.length, 0)} symbols, ${semantic.calls.length} calls.\n`);

  // ─── Sub-stage 1: CFG Construction ──────────────────────────────────────────
  let t0 = performance.now();
  const cfgBuilder = new DeterministicControlFlowGraphBuilder();
  const cfgs = astResults.flatMap((ast) => cfgBuilder.buildAll(ast));
  const cfgTime = performance.now() - t0;
  console.log(`  1. CFG Construction:               ${cfgTime.toFixed(2).padStart(8)} ms  (${cfgs.length} CFGs, ${cfgs.reduce((a, g) => a + g.blocks.length, 0)} blocks)`);

  // ─── Sub-stage 2: DFG Build Context (AST Walk) ──────────────────────────────
  t0 = performance.now();
  const dfgBuilder = new DeterministicDataFlowGraphBuilder();
  const symbolsByPath = new Map(symbolTables.map((table) => [table.filePath, table.symbols]));
  const contexts = astResults.map((ast) =>
    dfgBuilder.buildContext(
      ast,
      createProvenCallTargets(
        semantic.calls.flatMap((call) =>
          call.sourceFilePath === ast.metadata.sourcePath && call.resolutionState === "RESOLVED" && call.targetSymbolId !== undefined && call.location !== undefined
            ? [{ callId: call.id, sourceFilePath: call.sourceFilePath, location: call.location, targetSymbolId: call.targetSymbolId }]
            : [],
        ),
      ),
      symbolsByPath.get(ast.metadata.sourcePath) ?? [],
    ),
  );
  const dfgContextTime = performance.now() - t0;

  let totalDefs = 0;
  let totalUses = 0;
  for (const { graph } of contexts) {
    totalDefs += graph.definitions.length;
    totalUses += graph.uses.length;
  }
  console.log(`  2. DFG Context Build (AST Walk):   ${dfgContextTime.toFixed(2).padStart(8)} ms  (${contexts.length} DFGs, ${totalDefs} defs, ${totalUses} uses)`);

  // ─── Sub-stage 3: Interprocedural Summaries & Transfers ──────────────────────
  t0 = performance.now();
  const summaries = new Map(contexts.flatMap(({ graph }) => graph.functionSummaries.map((summary) => [summary.symbolId, summary] as const)));
  for (const table of symbolTables) {
    for (const exported of table.symbols.filter((symbol) => symbol.kind === "export" && symbol.moduleSpecifier === undefined)) {
      const localName = exported.sourceSymbolName ?? exported.name;
      const candidates = table.symbols.filter((symbol) =>
        (symbol.kind === "function" || symbol.kind === "method") && symbol.name === localName && symbol.scopeId === exported.scopeId,
      );
      const local = candidates.length === 1 ? candidates[0] : undefined;
      if (local === undefined) continue;
      const summary = summaries.get(local.id);
      if (summary !== undefined) summaries.set(exported.id, summary);
    }
  }

  const crossFileTransfersByGraph = new Map<string, unknown[]>();
  const allCrossFileTransfers: { sourceDefinitionId: string; targetDefinitionId: string }[] = [];

  for (const { graph } of contexts) {
    const transfers = [...graph.interproceduralFlows];
    for (const binding of graph.callBindings) {
      const target = summaries.get(binding.targetSymbolId);
      if (target === undefined || target.filePath === graph.filePath) continue;
      for (const [index, sourceDefinitionId] of binding.argumentDefinitionIds.entries()) {
        const slot = target.parameterDefinitionIds[index];
        if (sourceDefinitionId !== undefined && slot !== undefined) {
          const targetIds = Array.isArray(slot) ? slot : [slot];
          for (const parameterDefinitionId of targetIds) {
            transfers.push({ id: `transfer:${binding.callId}:${sourceDefinitionId}:${parameterDefinitionId}`, callId: binding.callId, kind: "argument-to-parameter", sourceDefinitionId, targetDefinitionId: parameterDefinitionId });
            allCrossFileTransfers.push({ sourceDefinitionId, targetDefinitionId: parameterDefinitionId });
          }
        }
      }
      if (binding.receiverDefinitionId !== undefined) {
        for (const returned of target.returnDefinitionIds) {
          transfers.push({ id: `transfer:${binding.callId}:${returned}:${binding.receiverDefinitionId}`, callId: binding.callId, kind: "return-to-receiver", sourceDefinitionId: returned, targetDefinitionId: binding.receiverDefinitionId });
          allCrossFileTransfers.push({ sourceDefinitionId: returned, targetDefinitionId: binding.receiverDefinitionId });
        }
      }
    }
    crossFileTransfersByGraph.set(graph.filePath, transfers);
  }

  const globalTaintPaths = new Map<string, Map<string, readonly string[]>>();
  for (const { state } of contexts) {
    for (const [defId, sourceMap] of state.taintPaths) {
      const globalSourceMap = globalTaintPaths.get(defId) ?? new Map<string, readonly string[]>();
      for (const [sourceId, path] of sourceMap) {
        globalSourceMap.set(sourceId, [...path]);
      }
      globalTaintPaths.set(defId, globalSourceMap);
    }
  }

  const allTransfers = [
    ...contexts.flatMap(({ state }) => state.transfers),
    ...allCrossFileTransfers,
  ].sort((left, right) => `${left.sourceDefinitionId}:${left.targetDefinitionId}`.localeCompare(`${right.sourceDefinitionId}:${right.targetDefinitionId}`));
  const transferSetupTime = performance.now() - t0;
  console.log(`  3. Transfer Linkage:               ${transferSetupTime.toFixed(2).padStart(8)} ms  (${allTransfers.length} total transfers, ${summaries.size} summaries)`);

  // ─── Sub-stage 4: Taint Fixpoint Iteration Loop ─────────────────────────────
  t0 = performance.now();
  let fixpointIterations = 0;
  let evaluations = 0;
  let pathsUpdated = 0;

  for (let changed = true; changed;) {
    changed = false;
    fixpointIterations++;
    for (const transfer of allTransfers) {
      evaluations++;
      const sourcePaths = globalTaintPaths.get(transfer.sourceDefinitionId);
      if (sourcePaths === undefined) continue;
      for (const [sourceId, path] of sourcePaths) {
        if (setGlobalTaintPath(globalTaintPaths, transfer.targetDefinitionId, sourceId, [...path, transfer.targetDefinitionId])) {
          changed = true;
          pathsUpdated++;
        }
      }
    }
  }
  const fixpointTime = performance.now() - t0;
  console.log(`  4. Taint Fixpoint Loop:            ${fixpointTime.toFixed(2).padStart(8)} ms  (${fixpointIterations} iterations, ${evaluations} transfer evaluations, ${pathsUpdated} updates)`);

  const totalFlowTime = cfgTime + dfgContextTime + transferSetupTime + fixpointTime;
  console.log(`\n------------------------------------------------------`);
  console.log(` TOTAL FLOW ANALYSIS TIME:           ${totalFlowTime.toFixed(2)} ms (${(totalFlowTime / 1000).toFixed(2)} s)`);
  console.log(` CFG: ${(cfgTime / totalFlowTime * 100).toFixed(1)}% | DFG Context: ${(dfgContextTime / totalFlowTime * 100).toFixed(1)}% | Transfer Link: ${(transferSetupTime / totalFlowTime * 100).toFixed(1)}% | Fixpoint: ${(fixpointTime / totalFlowTime * 100).toFixed(1)}%`);
  console.log(`======================================================\n`);
}

function setGlobalTaintPath(
  taintPaths: Map<string, Map<string, readonly string[]>>,
  definitionId: string,
  sourceId: string,
  path: readonly string[],
): boolean {
  if (path.slice(0, -1).includes(definitionId)) return false;
  const paths = taintPaths.get(definitionId) ?? new Map<string, readonly string[]>();
  const existing = paths.get(sourceId);
  if (existing !== undefined && (existing.length <= path.length || existing.join(":") <= path.join(":"))) return false;
  paths.set(sourceId, Object.freeze([...path]));
  taintPaths.set(definitionId, paths);
  return true;
}

const target = process.argv[2] ?? ".";
profileFlowSubstages(target).catch(console.error);
