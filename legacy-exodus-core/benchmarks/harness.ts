/**
 * Phase 3A — Benchmark Harness
 *
 * Invokes the LegacyExodus engine on a target repository and captures
 * structured analysis results suitable for benchmark comparison and governance.
 */

import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { memoryUsage } from "node:process";

import { createLegacyExodusEngine } from "@runtime/composition/services";

import { computeFileAccounting, detectContamination, verifyCompleteness } from "./governance";
import type {
  AnalysisDisposition,
  ArtifactHash,
  BenchmarkRunResult,
  FlowSummary,
  SemanticSummary,
} from "./types";

// ─── Public API ───────────────────────────────────────────────────────────────

export async function executeBenchmarkRun(
  projectPath: string,
  runIndex: number,
): Promise<BenchmarkRunResult> {
  const engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });

  await engine.initialize();

  try {
    const memBefore = memoryUsage().rss;
    const engineStarted = performance.now();

    const result = await engine.execute({
      id: "00000000-0000-4000-8000-b00000000000",
      type: "AnalyzeProject",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      payload: {
        projectId: "00000000-0000-4000-8000-b00000000001",
        path: projectPath,
      },
    });

    const engineWallMs = Math.round(performance.now() - engineStarted);
    const memAfter = memoryUsage().rss;
    const peakRssMb = Math.round((Math.max(memBefore, memAfter) / (1024 * 1024)) * 10) / 10;
    // The process's peak so far is the engine's: the summaries below re-read the projected JSON
    // (about 930 MB on Ghost), which a later reading would count as the engine's memory (NA-04).
    const engineMaxRssMb = Math.round((process.resourceUsage().maxRSS / 1024) * 10) / 10;

    if (result.type !== "AnalyzeProject") {
      throw new Error(`Unexpected engine result type: ${result.type}`);
    }

    const disposition: AnalysisDisposition = {
      filesDiscovered: result.analysis.filesDiscovered,
      filesAnalyzed: result.analysis.filesAnalyzed,
      parserFailures: result.analysis.parserFailures,
      symbolExtractionFailures: result.analysis.symbolExtractionFailures,
      secondPassFailures: result.analysis.secondPassFailures ?? 0,
      unsupportedFiles: result.analysis.unsupportedFiles,
      nonSourceArtifacts: result.analysis.nonSourceArtifacts,
      unclassifiedArtifacts: result.analysis.unclassifiedArtifacts,
      enumerationFailures: result.analysis.enumerationFailures ?? 0,
      discoveryComplete: result.analysis.discoveryComplete ?? true,
      durationMs: result.analysis.durationMs,
    };

    const discoveryDir = join(projectPath, ".discovery");
    const semantic = await extractSemanticSummary(discoveryDir);
    const flow = await extractFlowSummary(discoveryDir);
    const artifactHashes = await hashDiscoveryArtifacts(discoveryDir);
    const fileAccounting = computeFileAccounting(disposition);
    const contamination = detectContamination(result.discovery.files);
    const completeness = verifyCompleteness(disposition, fileAccounting, contamination);

    return {
      runIndex,
      disposition,
      semantic,
      flow,
      fileAccounting,
      completeness,
      contamination,
      artifactHashes,
      languages: [...result.discovery.languages],
      frameworks: result.discovery.frameworks.map((f) => f.name),
      dependencyCount: result.discovery.dependencies.length,
      peakRssMb,
      engineMaxRssMb,
      engineWallMs,
      snapshotReused: result.isReused === true,
    };
  } finally {
    await engine.shutdown();
  }
}

// ─── Semantic Summary Extraction ──────────────────────────────────────────────

async function extractSemanticSummary(discoveryDir: string): Promise<SemanticSummary> {
  const semantic = await readJsonSafe(join(discoveryDir, "semantic.json"));
  const symbols = await readJsonSafe(join(discoveryDir, "symbols.json"));
  const depGraph = await readJsonSafe(join(discoveryDir, "dependency-graph.json"));

  const calls = asArray(semantic?.calls);
  const allSymbols = asArray(symbols);
  const nodes = asArray(depGraph?.nodes);
  const edges = asArray(depGraph?.edges);
  const cycles = asArray(depGraph?.cycles);

  return {
    totalCalls: calls.length,
    resolvedCalls: calls.filter((c: Record<string, unknown>) => c.resolutionState === "RESOLVED").length,
    unresolvedCalls: calls.filter((c: Record<string, unknown>) => c.resolutionState === "UNRESOLVED").length,
    totalSymbols: allSymbols.length,
    functions: allSymbols.filter((s: Record<string, unknown>) => s.kind === "function").length,
    classes: allSymbols.filter((s: Record<string, unknown>) => s.kind === "class").length,
    methods: allSymbols.filter((s: Record<string, unknown>) => s.kind === "method").length,
    imports: allSymbols.filter((s: Record<string, unknown>) => s.kind === "import").length,
    exports: allSymbols.filter((s: Record<string, unknown>) => s.kind === "export").length,
    dependencyModules: nodes.length,
    dependencyEdges: edges.length,
    cycles: cycles.length,
    entryPoints: asArray(semantic?.entryPoints).length,
    routes: asArray(semantic?.routes).length,
    middlewareChains: asArray(semantic?.middlewareChains).length,
    deadCodeFindings: asArray(semantic?.deadCode).length,
    unusedImports: asArray(semantic?.unusedImports).length,
    unusedExports: asArray(semantic?.unusedExports).length,
  };
}

// ─── Flow Summary Extraction ──────────────────────────────────────────────────

async function extractFlowSummary(discoveryDir: string): Promise<FlowSummary> {
  const controlFlow = await readJsonSafe(join(discoveryDir, "control-flow.json"));
  const dataFlow = await readJsonSafe(join(discoveryDir, "data-flow.json"));
  const knowledge = await readJsonSafe(join(discoveryDir, "knowledge.json"));

  const rawCfgs = asArray(controlFlow?.graphs);
  const dfGraphs = asArray(dataFlow?.graphs);

  let basicBlockCount = 0;
  let controlFlowEdgeCount = 0;
  let dominatorRecordCount = 0;

  for (const g of rawCfgs) {
    const cg = g as Record<string, unknown>;
    basicBlockCount += asArray(cg.blocks).length;
    controlFlowEdgeCount += asArray(cg.edges).length;
    dominatorRecordCount += asArray(cg.dominators).length;
  }

  let totalDefinitions = 0;
  let totalUses = 0;
  let defUseChains = 0;
  let taintFlows = 0;
  let interproceduralFlows = 0;

  for (const graph of dfGraphs) {
    const g = graph as Record<string, unknown>;
    totalDefinitions += asArray(g.definitions).length;
    totalUses += asArray(g.uses).length;
    defUseChains += asArray(g.defUseChains).length;
    taintFlows += asArray(g.taintFlows).length;
    interproceduralFlows += asArray(g.interproceduralFlows).length;
  }

  return {
    cfgCount: rawCfgs.length,
    basicBlockCount,
    controlFlowEdgeCount,
    dominatorRecordCount,
    dfgCount: dfGraphs.length,
    totalDefinitions,
    totalUses,
    defUseChains,
    taintFlows,
    interproceduralFlows,
    knowledgeNodes: asArray(knowledge?.nodes).length,
    knowledgeEdges: asArray(knowledge?.edges).length,
  };
}

// ─── Artifact Hashing ─────────────────────────────────────────────────────────

async function hashDiscoveryArtifacts(discoveryDir: string): Promise<ArtifactHash[]> {
  let entries: string[];
  try {
    entries = await readdir(discoveryDir);
  } catch {
    return [];
  }

  const hashes: ArtifactHash[] = [];

  for (const entry of entries.sort()) {
    if (!entry.endsWith(".json") || entry === "manifest.json") continue;

    const filePath = join(discoveryDir, entry);
    const content = await readFile(filePath);
    const fileStat = await stat(filePath);

    hashes.push({
      name: entry,
      sizeBytes: fileStat.size,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }

  return hashes;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

async function readJsonSafe(filePath: string): Promise<Record<string, unknown> | unknown[] | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as Record<string, unknown> | unknown[];
  } catch {
    return null;
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
