/**
 * Phase 3A — Quality Sampling Script
 *
 * Reads analysis artifacts from a repository's .discovery/ directory and
 * randomly selects N items from each finding category for manual precision review.
 *
 * Usage:
 *   bun run benchmarks/scripts/sample.ts <repo-path> [--count N] [--output path]
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve, basename } from "node:path";

interface SampledCall {
  readonly calleeName: string;
  readonly resolutionState: string;
  readonly filePath?: string;
  readonly location?: Record<string, unknown>;
  readonly targetFilePath?: string;
  readonly targetSymbolName?: string;
  /** To be filled during manual review. */
  manualVerdict?: "correct" | "incorrect" | "uncertain";
  manualNote?: string;
}

interface SampledDependencyEdge {
  readonly source: string;
  readonly target: string;
  readonly importedName?: string;
  readonly exportedName?: string;
  manualVerdict?: "correct" | "incorrect" | "uncertain";
  manualNote?: string;
}

interface SampledTaintFlow {
  readonly filePath: string;
  readonly path: readonly string[];
  readonly state: string;
  manualVerdict?: "correct" | "incorrect" | "uncertain";
  manualNote?: string;
}

interface SampleSheet {
  readonly repository: string;
  readonly sampledAt: string;
  readonly sampleSize: number;
  readonly methodology: string;
  readonly resolvedCalls: readonly SampledCall[];
  readonly unresolvedCalls: readonly SampledCall[];
  readonly dependencyEdges: readonly SampledDependencyEdge[];
  readonly taintFlows: readonly SampledTaintFlow[];
  readonly confidence: string;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const repoPath = resolve(args[0] ?? ".");
  const sampleCount = parseInt(getArgValue(args, "--count") ?? "20", 10);
  const outputPath = getArgValue(args, "--output") ??
    resolve(import.meta.dir, "..", "golden", basename(repoPath));

  const discoveryDir = join(repoPath, ".discovery");
  const repoName = basename(repoPath);

  console.log(`\nLegacyExodus — Quality Sampling`);
  console.log(`Repository: ${repoName}`);
  console.log(`Sample size: ${sampleCount}\n`);

  // Read artifacts
  const semantic = await readJsonSafe(join(discoveryDir, "semantic.json"));
  const depGraph = await readJsonSafe(join(discoveryDir, "dependency-graph.json"));
  const dataFlow = await readJsonSafe(join(discoveryDir, "data-flow.json"));

  // Sample resolved calls
  const allCalls = asArray(semantic?.calls) as SampledCall[];
  const resolvedCalls = allCalls.filter((c) => c.resolutionState === "RESOLVED");
  const unresolvedCalls = allCalls.filter((c) => c.resolutionState === "UNRESOLVED");

  const sampledResolved = randomSample(resolvedCalls, sampleCount);
  const sampledUnresolved = randomSample(unresolvedCalls, sampleCount);

  console.log(`  Resolved calls:   ${resolvedCalls.length} total, ${sampledResolved.length} sampled`);
  console.log(`  Unresolved calls: ${unresolvedCalls.length} total, ${sampledUnresolved.length} sampled`);

  // Sample dependency edges
  const edges = asArray(depGraph?.edges) as SampledDependencyEdge[];
  const sampledEdges = randomSample(edges, sampleCount);
  console.log(`  Dependency edges: ${edges.length} total, ${sampledEdges.length} sampled`);

  // Sample taint flows
  const dfGraphs = asArray(dataFlow?.graphs);
  const allTaintFlows: SampledTaintFlow[] = [];
  for (const graph of dfGraphs) {
    const g = graph as Record<string, unknown>;
    const filePath = g.filePath as string ?? "unknown";
    for (const flow of asArray(g.taintFlows)) {
      const f = flow as Record<string, unknown>;
      allTaintFlows.push({
        filePath,
        path: asArray(f.path) as string[],
        state: f.state as string ?? "unknown",
      });
    }
  }
  const sampledTaintFlows = randomSample(allTaintFlows, sampleCount);
  console.log(`  Taint flows:      ${allTaintFlows.length} total, ${sampledTaintFlows.length} sampled`);

  // Build sample sheet
  const sheet: SampleSheet = {
    repository: repoName,
    sampledAt: new Date().toISOString(),
    sampleSize: sampleCount,
    methodology: `Random uniform sampling, min(${sampleCount}, available) per category. Deterministic seed not used — re-run produces different samples.`,
    resolvedCalls: sampledResolved,
    unresolvedCalls: sampledUnresolved,
    dependencyEdges: sampledEdges,
    taintFlows: sampledTaintFlows,
    confidence: `Sample-based precision only. ${sampleCount} samples per category. Not statistically representative of full population without larger sample sizes.`,
  };

  // Write sample sheet
  await mkdir(outputPath, { recursive: true });
  const outputFile = join(outputPath, "sample-sheet.json");
  await writeFile(outputFile, JSON.stringify(sheet, null, 2), "utf8");
  console.log(`\n  Sample sheet written to: ${outputFile}`);
  console.log(`  Review each item and fill in manualVerdict / manualNote fields.\n`);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function randomSample<T>(items: readonly T[], count: number): T[] {
  const available = [...items];
  const n = Math.min(count, available.length);
  const sampled: T[] = [];

  for (let i = 0; i < n; i++) {
    const idx = Math.floor(Math.random() * available.length);
    const item = available[idx];
    if (item !== undefined) {
      sampled.push(item);
      available.splice(idx, 1);
    }
  }

  return sampled;
}

async function readJsonSafe(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getArgValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

main().catch((error: unknown) => {
  console.error("Sampling failed:", error);
  process.exit(1);
});
