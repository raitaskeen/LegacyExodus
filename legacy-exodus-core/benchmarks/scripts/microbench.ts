/**
 * Microbenchmark & Stage-by-Stage Profiler with Real-time Output
 */

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { DiscoveryEngine } from "@discovery/index";
import { JavaScriptParser, ParserManager, ParserRegistry } from "@parser/index";
import { JavaScriptSymbolExtractor, type SymbolTable } from "@symbols/index";
import { DeterministicDependencyGraphBuilder, ModuleResolver } from "@graph/index";
import { DeterministicSemanticAnalysisEngine } from "@semantic/index";
import { DeterministicFlowAnalysisEngine } from "@flow/index";
import { DeterministicKnowledgeGraphBuilder } from "@knowledge/index";
import { createLegacyExodusEngine } from "@runtime/composition/services";
import { analyzeProject } from "@cli/commands/analyze";

export async function runProfile(targetPath: string): Promise<void> {
  const absPath = resolve(targetPath);
  const targetName = basename(absPath);

  console.log(`\n======================================================`);
  console.log(` PROFILING TARGET: ${targetName} (${absPath})`);
  console.log(`======================================================\n`);

  const mem = () => `${Math.round(process.memoryUsage().rss / (1024 * 1024))}MB`;

  // ─── 1. Stage-by-Stage Isolated Analyzers ────────────────────────────────────
  console.log(`--- [STAGE 1/2] ISOLATED PURE ANALYZERS ---`);

  // 1. Discovery
  let t0 = performance.now();
  const discovery = await new DiscoveryEngine().discover({
    projectId: "00000000-0000-4000-8000-000000000001",
    projectPath: absPath,
  });
  const discoveryTime = performance.now() - t0;
  console.log(`  1. Discovery:            ${discoveryTime.toFixed(2).padStart(8)} ms  (${discovery.files.length} files, RSS: ${mem()})`);

  // 2. Parser & Symbol Extraction
  const parserRegistry = new ParserRegistry();
  parserRegistry.register(new JavaScriptParser());
  const parserManager = new ParserManager(parserRegistry);
  const symbolExtractor = new JavaScriptSymbolExtractor();
  const sourceFiles = discovery.files.filter((f) => f.language === "javascript" || f.language === "typescript");

  t0 = performance.now();
  let parseTime = 0;
  let symbolTime = 0;
  const astResults = [];
  const symbolTables: SymbolTable[] = [];

  for (const file of sourceFiles) {
    let source: string;
    try { source = await readFile(resolve(absPath, file.path), "utf8"); } catch { continue; }

    const tp0 = performance.now();
    let ast;
    try { ast = await parserManager.parse({ file, source }); } catch { continue; }
    parseTime += performance.now() - tp0;

    if (ast.errors.length === 0) {
      astResults.push(ast);
      const ts0 = performance.now();
      try {
        const table = symbolExtractor.extract(ast);
        symbolTables.push(table);
      } catch {}
      symbolTime += performance.now() - ts0;
    }
  }
  console.log(`  2. AST Parsing:          ${parseTime.toFixed(2).padStart(8)} ms  (${astResults.length} files parsed, RSS: ${mem()})`);
  console.log(`  3. Symbol Extraction:    ${symbolTime.toFixed(2).padStart(8)} ms  (${symbolTables.reduce((a, t) => a + t.symbols.length, 0)} symbols, RSS: ${mem()})`);

  // 4. Dependency Graph
  t0 = performance.now();
  let pathAliases = {};
  try {
    const tsconfig = JSON.parse(await readFile(resolve(absPath, "tsconfig.json"), "utf8"));
    if (tsconfig?.compilerOptions?.paths) pathAliases = { paths: tsconfig.compilerOptions.paths, baseUrl: tsconfig.compilerOptions.baseUrl };
  } catch {}
  const depGraph = new DeterministicDependencyGraphBuilder(new ModuleResolver(pathAliases)).build(symbolTables, discovery.files);
  const depGraphTime = performance.now() - t0;
  console.log(`  4. Dependency Graph:     ${depGraphTime.toFixed(2).padStart(8)} ms  (${depGraph.edges.length} edges, ${depGraph.cycles.length} cycles, RSS: ${mem()})`);

  // 5. Semantic Analysis
  t0 = performance.now();
  const semantic = new DeterministicSemanticAnalysisEngine().analyze({ astResults, dependencyGraph: depGraph, symbolTables });
  const semanticTime = performance.now() - t0;
  console.log(`  5. Semantic Analysis:    ${semanticTime.toFixed(2).padStart(8)} ms  (${semantic.calls.length} calls, ${semantic.scopes.length} scopes, RSS: ${mem()})`);

  // 6. Flow Analysis
  t0 = performance.now();
  const flow = new DeterministicFlowAnalysisEngine().analyze(astResults, semantic.calls, symbolTables);
  const flowTime = performance.now() - t0;
  console.log(`  6. Flow Analysis:        ${flowTime.toFixed(2).padStart(8)} ms  (${flow.controlFlowGraphs.length} CFGs, ${flow.dataFlowGraphs.length} DFGs, RSS: ${mem()})`);

  // 7. Knowledge Graph
  t0 = performance.now();
  const kg = new DeterministicKnowledgeGraphBuilder().build(symbolTables, depGraph);
  const kgTime = performance.now() - t0;
  console.log(`  7. Knowledge Graph:      ${kgTime.toFixed(2).padStart(8)} ms  (${kg.nodes.length} nodes, ${kg.edges.length} edges, RSS: ${mem()})`);

  const pureEngineTime = discoveryTime + parseTime + symbolTime + depGraphTime + semanticTime + flowTime + kgTime;
  console.log(`\n  >>> SUM OF PURE ANALYSIS STAGES: ${pureEngineTime.toFixed(2)} ms (${(pureEngineTime / 1000).toFixed(2)} s) <<<\n`);

  // ─── 2. Full Engine Execution (Storage + Projection Included) ─────────────────
  console.log(`--- [STAGE 2/2] FULL ENGINE ORCHESTRATION ---`);
  t0 = performance.now();
  const engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });
  await engine.initialize();
  const execResult = await engine.execute({
    id: "00000000-0000-4000-8000-000000000001",
    type: "AnalyzeProject",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    payload: { projectId: "00000000-0000-4000-8000-000000000002", path: absPath },
  });
  await engine.shutdown();
  const fullEngineTime = performance.now() - t0;
  const storageAndProjectionTime = fullEngineTime - pureEngineTime;

  console.log(`  Full Engine Execution:   ${fullEngineTime.toFixed(2).padStart(8)} ms (${(fullEngineTime / 1000).toFixed(2)} s, RSS: ${mem()})`);
  console.log(`  Analysis Handler Time:   ${execResult.type === "AnalyzeProject" ? execResult.analysis.durationMs.toFixed(2).padStart(8) : "N/A"} ms`);
  console.log(`  Storage/Projection delta:${storageAndProjectionTime.toFixed(2).padStart(8)} ms (${(storageAndProjectionTime / 1000).toFixed(2)} s)`);

  // ─── 3. Artifact Hashing ─────────────────────────────────────────────────────
  t0 = performance.now();
  const discDir = join(absPath, ".discovery");
  let entries: string[] = [];
  try { entries = await readdir(discDir); } catch {}
  let totalBytes = 0;
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const content = await readFile(join(discDir, entry));
    totalBytes += content.byteLength;
    createHash("sha256").update(content).digest("hex");
  }
  const hashTime = performance.now() - t0;
  console.log(`  Artifact Hashing:        ${hashTime.toFixed(2).padStart(8)} ms (${entries.length} files, ${(totalBytes / (1024 * 1024)).toFixed(2)} MB)\n`);

  console.log(`======================================================`);
  console.log(` SUMMARY BREAKDOWN:`);
  console.log(` Pure Analysis Time:      ${pureEngineTime.toFixed(1).padStart(8)} ms (${((pureEngineTime / fullEngineTime) * 100).toFixed(1)}%)`);
  console.log(` Storage/Projection Time: ${storageAndProjectionTime.toFixed(1).padStart(8)} ms (${((storageAndProjectionTime / fullEngineTime) * 100).toFixed(1)}%)`);
  console.log(` Artifact Hashing:        ${hashTime.toFixed(1).padStart(8)} ms`);
  console.log(` Total Monitored Time:    ${(fullEngineTime + hashTime).toFixed(1).padStart(8)} ms`);
  console.log(`======================================================\n`);
}

const target = process.argv[2] ?? ".";
runProfile(target).catch(console.error);
