/**
 * Phase 3A — Determinism Verification & Semantic Invariant Checking
 *
 * Compares canonical artifacts across N benchmark runs to verify
 * that the engine produces identical output for identical input.
 *
 * Distinguishes runtime-variable process data (durationMs, process memory, run UUID)
 * from strict semantic artifacts (symbols, dependencies, CFGs, DFGs, taint, knowledge).
 */

import type { ArtifactDeterminismStatus, BenchmarkRunResult, DeterminismReport } from "./types";

const RUNTIME_VARIABLE_FIELDS = Object.freeze([
  "durationMs",
  "createdAt",
  "runId",
  "peakRssMb",
  "analysis.durationMs",
]);

export function verifyDeterminism(runs: readonly BenchmarkRunResult[]): DeterminismReport {
  if (runs.length < 2) {
    return {
      totalRuns: runs.length,
      allDeterministic: true,
      artifacts: [],
      variableFieldsIgnored: RUNTIME_VARIABLE_FIELDS,
      semanticDifferences: [],
    };
  }

  const firstRun = runs[0];
  if (firstRun === undefined) {
    return {
      totalRuns: 0,
      allDeterministic: true,
      artifacts: [],
      variableFieldsIgnored: RUNTIME_VARIABLE_FIELDS,
      semanticDifferences: [],
    };
  }

  const artifactNames = firstRun.artifactHashes.map((a) => a.name);
  const artifactStatuses: ArtifactDeterminismStatus[] = [];
  const semanticDifferences: string[] = [];
  let allDeterministic = true;

  for (const name of artifactNames) {
    const hashes = runs.map((run) => {
      const artifact = run.artifactHashes.find((a) => a.name === name);
      return artifact?.sha256 ?? "MISSING";
    });

    const uniqueHashes = new Set(hashes);
    const identical = uniqueHashes.size === 1;

    if (!identical) {
      allDeterministic = false;
      semanticDifferences.push(`Artifact ${name} has ${uniqueHashes.size} distinct SHA-256 hashes across ${runs.length} runs`);
    }

    artifactStatuses.push({
      name,
      identical,
      ...(identical ? {} : { hashes }),
    });
  }

  // Verify disposition consistency
  for (let i = 1; i < runs.length; i++) {
    const r = runs[i];
    if (!r) continue;

    if (r.disposition.filesDiscovered !== firstRun.disposition.filesDiscovered) {
      allDeterministic = false;
      semanticDifferences.push(`Run ${i + 1} filesDiscovered mismatch: ${r.disposition.filesDiscovered} vs ${firstRun.disposition.filesDiscovered}`);
    }
    if (r.disposition.filesAnalyzed !== firstRun.disposition.filesAnalyzed) {
      allDeterministic = false;
      semanticDifferences.push(`Run ${i + 1} filesAnalyzed mismatch: ${r.disposition.filesAnalyzed} vs ${firstRun.disposition.filesAnalyzed}`);
    }
    if (r.semantic.totalCalls !== firstRun.semantic.totalCalls) {
      allDeterministic = false;
      semanticDifferences.push(`Run ${i + 1} totalCalls mismatch: ${r.semantic.totalCalls} vs ${firstRun.semantic.totalCalls}`);
    }
    if (r.semantic.resolvedCalls !== firstRun.semantic.resolvedCalls) {
      allDeterministic = false;
      semanticDifferences.push(`Run ${i + 1} resolvedCalls mismatch: ${r.semantic.resolvedCalls} vs ${firstRun.semantic.resolvedCalls}`);
    }
    if (r.flow.cfgCount !== firstRun.flow.cfgCount) {
      allDeterministic = false;
      semanticDifferences.push(`Run ${i + 1} cfgCount mismatch: ${r.flow.cfgCount} vs ${firstRun.flow.cfgCount}`);
    }
    if (r.flow.totalDefinitions !== firstRun.flow.totalDefinitions) {
      allDeterministic = false;
      semanticDifferences.push(`Run ${i + 1} totalDefinitions mismatch: ${r.flow.totalDefinitions} vs ${firstRun.flow.totalDefinitions}`);
    }
  }

  return {
    totalRuns: runs.length,
    allDeterministic,
    artifacts: artifactStatuses,
    variableFieldsIgnored: RUNTIME_VARIABLE_FIELDS,
    semanticDifferences,
  };
}
