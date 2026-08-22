/**
 * Phase 3A — Deterministic Quality Sampling Subsystem
 *
 * Implements deterministic, reproducible quality sampling derived from:
 *   Seed = SHA256(repoSha + engineSha + userSeed)
 *
 * Ensures:
 *   sample(Run A) == sample(Run B) for identical inputs.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type {
  QualitySamplingReport,
  SampledCall,
  SampledDependencyEdge,
  SampledTaintFlow,
} from "./types";

class DeterministicSamplerRng {
  private state: number;

  public constructor(seedHex: string) {
    // Take first 8 chars of SHA-256 as 32-bit uint seed
    this.state = parseInt(seedHex.slice(0, 8), 16) >>> 0;
  }

  public nextUint(): number {
    this.state = (Math.imul(1664525, this.state) + 1013904223) >>> 0;
    return this.state;
  }

  public nextInt(min: number, max: number): number {
    const range = max - min + 1;
    return min + (this.nextUint() % range);
  }

  public sample<T>(items: readonly T[], count: number): T[] {
    if (items.length <= count) return [...items];
    const copy = [...items];
    const result: T[] = [];
    for (let i = 0; i < count; i++) {
      const idx = this.nextInt(0, copy.length - 1);
      const chosen = copy.splice(idx, 1)[0];
      if (chosen !== undefined) result.push(chosen);
    }
    return result;
  }
}

export function deriveSampleSeed(repoSha: string, engineSha: string, userSeed = 42): string {
  return createHash("sha256").update(`${repoSha}:${engineSha}:${userSeed}`).digest("hex");
}

export async function generateQualitySample(
  discoveryDir: string,
  repoSha: string,
  engineSha: string,
  sampleSize = 20,
  userSeed = 42,
): Promise<QualitySamplingReport> {
  const derivationHash = deriveSampleSeed(repoSha, engineSha, userSeed);
  const rng = new DeterministicSamplerRng(derivationHash);

  // Read raw analysis artifacts
  const semantic = await readJsonSafe(join(discoveryDir, "semantic.json"));
  const depGraph = await readJsonSafe(join(discoveryDir, "dependency-graph.json"));
  const dataFlow = await readJsonSafe(join(discoveryDir, "data-flow.json"));

  // Extract calls
  const allCalls = asArray<SampledCall>(semantic?.calls);
  const resolvedCalls = allCalls.filter((c) => c.resolutionState === "RESOLVED");
  const unresolvedCalls = allCalls.filter((c) => c.resolutionState === "UNRESOLVED");

  // Extract dependency edges
  const allEdges = asArray<SampledDependencyEdge>(depGraph?.edges);

  // Extract taint flows
  const allTaintFlows: SampledTaintFlow[] = [];
  for (const g of asArray<Record<string, unknown>>(dataFlow?.graphs)) {
    const filePath = (g.filePath as string) ?? "unknown";
    for (const f of asArray<Record<string, unknown>>(g.taintFlows)) {
      allTaintFlows.push({
        filePath,
        path: asArray<string>(f.path),
        state: (f.state as string) ?? "INFERRED",
      });
    }
  }

  // Sample deterministically
  const sampledResolved = rng.sample(resolvedCalls, sampleSize);
  const sampledUnresolved = rng.sample(unresolvedCalls, sampleSize);
  const sampledEdges = rng.sample(allEdges, sampleSize);
  const sampledTaint = rng.sample(allTaintFlows, sampleSize);

  const confidenceNotes =
    `Deterministic sample of ${sampleSize} items per category derived from seed ${userSeed} (hash: ${derivationHash.slice(0, 12)}). ` +
    `Represents evidence-based sample for manual precision audit; not an asymptotic statistical extrapolation.`;

  return {
    sampleSeed: userSeed,
    derivationHash,
    sampleSize,
    population: {
      totalResolvedCalls: resolvedCalls.length,
      totalUnresolvedCalls: unresolvedCalls.length,
      totalDependencyEdges: allEdges.length,
      totalTaintFlows: allTaintFlows.length,
    },
    sampledResolvedCalls: sampledResolved,
    sampledUnresolvedCalls: sampledUnresolved,
    sampledDependencyEdges: sampledEdges,
    sampledTaintFlows: sampledTaint,
    confidenceNotes,
  };
}

async function readJsonSafe(filePath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
