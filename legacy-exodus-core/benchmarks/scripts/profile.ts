/**
 * Phase 3A — Comprehensive Pipeline Profiler
 *
 * Measures the exact stage-by-stage timings and memory footprint
 * of the LegacyExodus analysis engine.
 *
 * Usage:
 *   bun run benchmarks/scripts/profile.ts <target-path>
 */

import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { DiscoveryEngine } from "@discovery/index";
import { JavaScriptParser, ParserManager, ParserRegistry } from "@parser/index";
import { JavaScriptSymbolExtractor, type SymbolTable } from "@symbols/index";
import { DeterministicDependencyGraphBuilder, ModuleResolver, type ModuleResolutionOptions } from "@graph/index";
import { DeterministicSemanticAnalysisEngine } from "@semantic/index";
import { DeterministicFlowAnalysisEngine } from "@flow/index";
import { DeterministicKnowledgeGraphBuilder } from "@knowledge/index";
import { createStorageRecord, type StorageRecord } from "@storage/storage-record";
import { MemoryStorageProvider } from "@storage/adapters/memory-storage";
import { StorageManager } from "@storage/storage-manager";
import { DiscoveryProjectionService } from "@storage/projections/discovery-projection-service";
import { FileDiscoveryProjectionAdapter } from "@storage/projections/file-discovery-projection";
import { analyzeProject } from "@cli/commands/analyze";

export interface StageTiming {
  readonly stage: string;
  readonly durationMs: number;
  readonly details?: Record<string, string | number>;
}

export interface ProfileReport {
  readonly target: string;
  readonly path: string;
  readonly totalFiles: number;
  readonly analyzedFiles: number;
  readonly totalDurationMs: number;
  readonly stages: readonly StageTiming[];
  readonly memory: {
    readonly initialRssMb: number;
    readonly peakRssMb: number;
    readonly finalRssMb: number;
  };
}

export async function profilePipeline(targetPath: string): Promise<ProfileReport> {
  const absolutePath = resolve(targetPath);
  const targetName = basename(absolutePath);
  const stages: StageTiming[] = [];
  const initialMem = process.memoryUsage().rss / (1024 * 1024);
  let peakMem = initialMem;

  const updatePeakMem = () => {
    const current = process.memoryUsage().rss / (1024 * 1024);
    if (current > peakMem) peakMem = current;
  };

  const totalStart = performance.now();

  // ─── 1. Discovery ─────────────────────────────────────────────────────────────
  let t0 = performance.now();
  const discoveryEngine = new DiscoveryEngine();
  const discovery = await discoveryEngine.discover({
    projectId: "00000000-0000-4000-8000-000000000001",
    projectPath: absolutePath,
  });
  const discoveryMs = performance.now() - t0;
  updatePeakMem();
  stages.push({
    stage: "1. Discovery",
    durationMs: discoveryMs,
    details: {
      filesDiscovered: discovery.files.length,
      languages: discovery.languages.join(", "),
      dependencies: discovery.dependencies.length,
      frameworks: discovery.frameworks.map((f) => f.name).join(", ") || "none",
    },
  });

  // ─── 2. Parsing & 3. Symbol Extraction ────────────────────────────────────────
  const parserRegistry = new ParserRegistry();
  parserRegistry.register(new JavaScriptParser());
  const parserManager = new ParserManager(parserRegistry);
  const symbolExtractor = new JavaScriptSymbolExtractor();

  const sourceFiles = discovery.files.filter(
    (f) => f.language === "javascript" || f.language === "typescript",
  );

  let parseTotalMs = 0;
  let symbolTotalMs = 0;
  const astResults = [];
  const symbolTables: SymbolTable[] = [];

  for (const file of sourceFiles) {
    let source: string;
    try {
      source = await readFile(resolve(absolutePath, file.path), "utf8");
    } catch {
      continue;
    }

    t0 = performance.now();
    let ast;
    try {
      ast = await parserManager.parse({ file, source });
    } catch {
      continue;
    }
    parseTotalMs += performance.now() - t0;

    if (ast.errors.length === 0) {
      astResults.push(ast);

      t0 = performance.now();
      try {
        const table = symbolExtractor.extract(ast);
        symbolTables.push(table);
      } catch {
        // isolated
      }
      symbolTotalMs += performance.now() - t0;
    }
  }
  updatePeakMem();

  stages.push({
    stage: "2. AST Parsing",
    durationMs: parseTotalMs,
    details: { filesParsed: astResults.length, avgPerFileMs: (parseTotalMs / (astResults.length || 1)).toFixed(2) },
  });

  const totalSymbols = symbolTables.reduce((acc, t) => acc + t.symbols.length, 0);
  stages.push({
    stage: "3. Symbol Extraction",
    durationMs: symbolTotalMs,
    details: { totalSymbols, tablesCount: symbolTables.length, avgPerFileMs: (symbolTotalMs / (symbolTables.length || 1)).toFixed(2) },
  });

  // ─── 4. Dependency Graph ──────────────────────────────────────────────────────
  t0 = performance.now();
  const pathAliases = await readPathAliases(absolutePath);
  const depGraphBuilder = new DeterministicDependencyGraphBuilder(new ModuleResolver(pathAliases));
  const dependencyGraph = depGraphBuilder.build(symbolTables, discovery.files);
  const depGraphMs = performance.now() - t0;
  updatePeakMem();

  stages.push({
    stage: "4. Dependency Graph",
    durationMs: depGraphMs,
    details: { nodes: dependencyGraph.nodes.length, edges: dependencyGraph.edges.length, cycles: dependencyGraph.cycles.length },
  });

  // ─── 5. Semantic Analysis ─────────────────────────────────────────────────────
  t0 = performance.now();
  const semanticEngine = new DeterministicSemanticAnalysisEngine();
  const semantic = semanticEngine.analyze({ astResults, dependencyGraph, symbolTables });
  const semanticMs = performance.now() - t0;
  updatePeakMem();

  stages.push({
    stage: "5. Semantic Analysis",
    durationMs: semanticMs,
    details: {
      totalCalls: semantic.calls.length,
      resolved: semantic.calls.filter((c) => c.resolutionState === "RESOLVED").length,
      unresolved: semantic.calls.filter((c) => c.resolutionState === "UNRESOLVED").length,
      scopes: semantic.scopes.length,
      references: semantic.references.length,
    },
  });

  // ─── 6. Flow Analysis (CFG + DFG + Interprocedural + Taint) ──────────────────
  t0 = performance.now();
  const flowEngine = new DeterministicFlowAnalysisEngine();
  const flow = flowEngine.analyze(astResults, semantic.calls, symbolTables);
  const flowMs = performance.now() - t0;
  updatePeakMem();

  let totalDefs = 0;
  let totalUses = 0;
  let totalDefUseChains = 0;
  let totalTaintFlows = 0;
  let totalInterproceduralFlows = 0;
  for (const g of flow.dataFlowGraphs) {
    totalDefs += g.definitions.length;
    totalUses += g.uses.length;
    totalDefUseChains += g.defUseChains.length;
    totalTaintFlows += g.taintFlows.length;
    totalInterproceduralFlows += g.interproceduralFlows.length;
  }

  stages.push({
    stage: "6. Flow Analysis (CFG/DFG/Taint)",
    durationMs: flowMs,
    details: {
      cfgCount: flow.controlFlowGraphs.length,
      dfgCount: flow.dataFlowGraphs.length,
      definitions: totalDefs,
      uses: totalUses,
      defUseChains: totalDefUseChains,
      taintFlows: totalTaintFlows,
      interproceduralFlows: totalInterproceduralFlows,
    },
  });

  // ─── 7. Knowledge Graph ───────────────────────────────────────────────────────
  t0 = performance.now();
  const kgBuilder = new DeterministicKnowledgeGraphBuilder();
  const knowledgeGraph = kgBuilder.build(symbolTables, dependencyGraph);
  const kgMs = performance.now() - t0;
  updatePeakMem();

  stages.push({
    stage: "7. Knowledge Graph",
    durationMs: kgMs,
    details: { nodes: knowledgeGraph.nodes.length, edges: knowledgeGraph.edges.length },
  });

  // ─── 8. Storage Record Creation (Serialization/Cloning/Freezing) ─────────────
  t0 = performance.now();
  const records: StorageRecord[] = [];
  const recTimes: Record<string, number> = {};

  const timedRecord = (type: string, payload: any) => {
    const start = performance.now();
    const rec = createStorageRecord(type, payload);
    const elapsed = performance.now() - start;
    recTimes[type] = (recTimes[type] ?? 0) + elapsed;
    records.push(rec);
  };

  timedRecord("project-discovery", {
    projectId: discovery.projectId,
    projectName: discovery.projectName,
    projectPath: discovery.projectPath,
    files: discovery.files.map((file) => ({ ...file })),
    dependencies: discovery.dependencies.map((d) => ({ ...d })),
    frameworks: discovery.frameworks.map((f) => ({ ...f })),
    languages: [...discovery.languages],
    discoveredAt: discovery.discoveredAt.toISOString(),
    analysisRunId: "profile-run",
  });

  for (const ast of astResults) {
    timedRecord("ast-result", {
      fileId: ast.metadata.sourcePath,
      path: ast.metadata.sourcePath,
      parserId: ast.metadata.parserId,
      nodeCount: ast.statistics.nodeCount,
      errorCount: ast.errors.length,
    });
  }

  for (const table of symbolTables) {
    timedRecord("symbol-table", {
      fileId: table.filePath,
      path: table.filePath,
      projectId: discovery.projectId,
      analysisRunId: "profile-run",
      symbolCount: table.symbols.length,
      classes: table.summary.classes,
      functions: table.summary.functions,
      imports: table.summary.imports,
      exports: table.summary.exports,
      symbols: table.symbols.map((s) => ({ ...s })),
    });
  }

  timedRecord("dependency-graph", {
    projectId: discovery.projectId,
    analysisRunId: "profile-run",
    nodes: dependencyGraph.nodes.map((n) => ({ ...n })),
    edges: dependencyGraph.edges.map((e) => ({ ...e })),
    cycles: dependencyGraph.cycles.map((c) => [...c]),
  });

  timedRecord("semantic-analysis", {
    projectId: discovery.projectId,
    analysisRunId: "profile-run",
    calls: semantic.calls.map((c) => ({ ...c })),
    references: semantic.references.map((r) => ({ ...r })),
    scopes: semantic.scopes.map((s) => ({ ...s })),
    deadCode: semantic.deadCode.map((d) => ({ ...d })),
    unusedImports: semantic.unusedImports.map((u) => ({ ...u })),
    unusedExports: semantic.unusedExports.map((u) => ({ ...u })),
    entryPoints: semantic.entryPoints.map((e) => ({ ...e })),
    routes: semantic.routes.map((r) => ({ ...r })),
    middlewareChains: semantic.middlewareChains.map((m) => ({ ...m })),
  });

  timedRecord("control-flow-analysis", {
    projectId: discovery.projectId,
    analysisRunId: "profile-run",
    graphs: flow.controlFlowGraphs.map((graph) => ({
      ...graph,
      blocks: graph.blocks.map((block) => ({
        ...block,
        statements: block.statements.map((statement) => ({ ...statement })),
      })),
      edges: graph.edges.map((edge) => ({ ...edge })),
      dominators: graph.dominators.map((dominator) => ({ ...dominator })),
      loops: graph.loops.map((loop) => ({ ...loop, blockIds: [...loop.blockIds] })),
      unreachableBlockIds: [...graph.unreachableBlockIds],
      deadCodeNodeIds: [...graph.deadCodeNodeIds],
    })),
  });

  timedRecord("data-flow-analysis", {
    projectId: discovery.projectId,
    analysisRunId: "profile-run",
    graphs: flow.dataFlowGraphs.map((graph) => ({
      ...graph,
      definitions: graph.definitions.map((definition) => ({ ...definition })),
      uses: graph.uses.map((use) => ({ ...use })),
      defUseChains: graph.defUseChains.map((chain) => ({ ...chain, useIds: [...chain.useIds] })),
      lifetimes: graph.lifetimes.map((lifetime) => ({ ...lifetime, useIds: [...lifetime.useIds] })),
      taintFlows: graph.taintFlows.map((flow) => ({ ...flow, path: [...flow.path] })),
      interproceduralFlows: graph.interproceduralFlows.map((flow) => ({ ...flow })),
      functionSummaries: graph.functionSummaries.map((summary) => ({
        ...summary,
        parameterDefinitionIds: [...summary.parameterDefinitionIds],
        returnDefinitionIds: [...summary.returnDefinitionIds],
      })),
      callBindings: graph.callBindings.map((binding) => ({
        callId: binding.callId,
        targetSymbolId: binding.targetSymbolId,
        argumentDefinitionIds: binding.argumentDefinitionIds.map((definitionId) => definitionId ?? null),
        ...(binding.receiverDefinitionId === undefined ? {} : { receiverDefinitionId: binding.receiverDefinitionId }),
      })),
    })),
  });

  timedRecord("knowledge-graph", {
    projectId: discovery.projectId,
    analysisRunId: "profile-run",
    nodes: knowledgeGraph.nodes.map((n) => ({ ...n })),
    edges: knowledgeGraph.edges.map((e) => ({ ...e })),
  });

  const storageRecordCreationMs = performance.now() - t0;
  updatePeakMem();

  stages.push({
    stage: "8. Storage Record Creation (Validation/Clone/Freeze)",
    durationMs: storageRecordCreationMs,
    details: {
      totalRecords: records.length,
      cfgRecordMs: (recTimes["control-flow-analysis"] ?? 0).toFixed(2),
      dfgRecordMs: (recTimes["data-flow-analysis"] ?? 0).toFixed(2),
      semanticRecordMs: (recTimes["semantic-analysis"] ?? 0).toFixed(2),
      symbolTablesMs: (recTimes["symbol-table"] ?? 0).toFixed(2),
    },
  });

  // ─── 9. Storage Save (MemoryStorageProvider) ─────────────────────────────────
  t0 = performance.now();
  const storageProvider = new MemoryStorageProvider();
  const storageManager = new StorageManager(storageProvider);
  for (const record of records) {
    await storageManager.save(record);
  }
  const storageSaveMs = performance.now() - t0;
  updatePeakMem();

  stages.push({
    stage: "9. Storage Save (In-Memory Clone)",
    durationMs: storageSaveMs,
    details: { recordsSaved: records.length },
  });

  // ─── 10. File Discovery Projection ───────────────────────────────────────────
  t0 = performance.now();
  const projectionService = new DiscoveryProjectionService(storageManager, new FileDiscoveryProjectionAdapter());
  const discoveryRecord = records.find((r) => r.type === "project-discovery");
  if (discoveryRecord) {
    await projectionService.project(discoveryRecord.id);
  }
  const projectionMs = performance.now() - t0;
  updatePeakMem();

  stages.push({
    stage: "10. Projection (Disk File Writes)",
    durationMs: projectionMs,
  });

  // ─── 11. Artifact Hashing ─────────────────────────────────────────────────────
  t0 = performance.now();
  const discoveryDir = join(absolutePath, ".discovery");
  let entries: string[] = [];
  try { entries = await readdir(discoveryDir); } catch {}
  let totalBytesHashed = 0;
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const content = await readFile(join(discoveryDir, entry));
    totalBytesHashed += content.byteLength;
    createHash("sha256").update(content).digest("hex");
  }
  const hashingMs = performance.now() - t0;
  updatePeakMem();

  stages.push({
    stage: "11. Artifact Hashing",
    durationMs: hashingMs,
    details: { filesHashed: entries.length, totalMbHashed: (totalBytesHashed / (1024 * 1024)).toFixed(2) },
  });

  const totalDurationMs = performance.now() - totalStart;
  const finalMem = process.memoryUsage().rss / (1024 * 1024);

  return {
    target: targetName,
    path: absolutePath,
    totalFiles: discovery.files.length,
    analyzedFiles: astResults.length,
    totalDurationMs,
    stages,
    memory: {
      initialRssMb: Math.round(initialMem),
      peakRssMb: Math.round(peakMem),
      finalRssMb: Math.round(finalMem),
    },
  };
}

async function readPathAliases(projectPath: string): Promise<ModuleResolutionOptions> {
  try {
    const parsed: any = JSON.parse(await readFile(resolve(projectPath, "tsconfig.json"), "utf8"));
    if (typeof parsed !== "object" || parsed === null || !("compilerOptions" in parsed)) return {};
    const options = parsed.compilerOptions;
    if (typeof options !== "object" || options === null) return {};
    const paths = typeof options.paths === "object" && options.paths !== null
      ? Object.fromEntries(Object.entries(options.paths).flatMap(([key, targets]) => Array.isArray(targets) && targets.every((t) => typeof t === "string") ? [[key, Object.freeze([...targets].sort())]] : []))
      : undefined;
    return { ...(typeof options.baseUrl === "string" ? { baseUrl: options.baseUrl } : {}), ...(paths === undefined ? {} : { paths }) };
  } catch { return {}; }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const targetPath = args[0] ?? ".";

  console.log(`\n╔══════════════════════════════════════════════════════════╗`);
  console.log(`║  LegacyExodus Phase 3A — Pipeline Profiler              ║`);
  console.log(`╚══════════════════════════════════════════════════════════╝\n`);

  console.log(`Profiling target: ${resolve(targetPath)}...\n`);

  const report = await profilePipeline(targetPath);

  console.log(`Target:           ${report.target}`);
  console.log(`Total files:      ${report.totalFiles}`);
  console.log(`Analyzed files:   ${report.analyzedFiles}`);
  console.log(`Total duration:   ${report.totalDurationMs.toFixed(2)} ms (${(report.totalDurationMs / 1000).toFixed(2)} s)`);
  console.log(`Memory RSS:       Initial: ${report.memory.initialRssMb}MB | Peak: ${report.memory.peakRssMb}MB | Final: ${report.memory.finalRssMb}MB\n`);

  console.log(`Stage Breakdown:`);
  console.log(`--------------------------------------------------------------------------------------------------------`);
  console.log(`Stage                                                  | Time (ms)  |   % Total | Details`);
  console.log(`--------------------------------------------------------------------------------------------------------`);

  for (const s of report.stages) {
    const pct = ((s.durationMs / report.totalDurationMs) * 100).toFixed(1);
    const detailsStr = s.details ? JSON.stringify(s.details) : "";
    console.log(
      `${s.stage.padEnd(54)} | ${s.durationMs.toFixed(1).padStart(10)} | ${pct.padStart(8)}% | ${detailsStr}`,
    );
  }
  console.log(`--------------------------------------------------------------------------------------------------------\n`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Profiling failed:", err);
    process.exit(1);
  });
}
