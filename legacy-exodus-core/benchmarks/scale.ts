/**
 * Scale benchmark (Wave 3d, BA-28 / BA-17): one fresh analysis of a `scale` tier corpus, with the engine's
 * wall time and the process's peak resident memory when the engine returned checked against the manifest's
 * budgets. Any earlier `.discovery` is removed first, so a stored snapshot is never measured instead of an
 * analysis, and the harness's re-reading of the output afterwards is not counted (NA-04). Run on request:
 *
 *   bun run benchmarks/cli.ts scale <name>
 *
 * The corpus is fetched at its pinned commit (and its tree verified) if it is not cached yet.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { executeBenchmarkRun } from "./harness";
import { CACHE_DIR, RESULTS_DIR } from "./paths";
import { ensureCorpusCheckout, findCorpusManifest } from "./scripts/acquire";
import { ensureSyntheticCorpus } from "./synthetic";

export interface ScaleResult {
  readonly name: string;
  readonly commit: string | undefined;
  readonly wallMs: number;
  readonly peakRssMb: number;
  readonly filesDiscovered: number;
  readonly filesAnalyzed: number;
  readonly budgets: { readonly maxWallMs: number; readonly maxPeakRssMb: number };
  readonly withinBudget: boolean;
}

/** One fresh analysis of `corpus`: the engine's own wall time and peak memory (NA-04). */
async function measure(corpus: string): Promise<{ readonly wallMs: number; readonly peakRssMb: number; readonly filesDiscovered: number; readonly filesAnalyzed: number }> {
  // A snapshot from an earlier run would be reused instead of analysed.
  await rm(join(corpus, ".discovery"), { recursive: true, force: true });
  const run = await executeBenchmarkRun(corpus, 0);
  if (run.snapshotReused === true || run.engineWallMs === undefined || run.engineMaxRssMb === undefined) {
    throw new Error(`Scale run of ${corpus} did not measure a fresh analysis.`);
  }
  return { wallMs: run.engineWallMs, peakRssMb: run.engineMaxRssMb, filesDiscovered: run.disposition.filesDiscovered, filesAnalyzed: run.disposition.filesAnalyzed };
}

export async function runScaleBenchmark(name: string): Promise<ScaleResult> {
  const manifest = await findCorpusManifest(name);
  if (manifest === null) throw new Error(`No corpus manifest named '${name}'.`);
  if (manifest.tier !== "scale" || manifest.budgets === undefined) throw new Error(`'${name}' is not a scale benchmark with budgets.`);

  const checkout = join(CACHE_DIR, manifest.name);
  await ensureCorpusCheckout(checkout);

  const run = await measure(checkout);
  const result: ScaleResult = {
    name: manifest.name,
    commit: manifest.commit,
    ...run,
    budgets: manifest.budgets,
    withinBudget: run.wallMs <= manifest.budgets.maxWallMs && run.peakRssMb <= manifest.budgets.maxPeakRssMb,
  };
  await mkdir(RESULTS_DIR, { recursive: true });
  await writeFile(join(RESULTS_DIR, `scale-${manifest.name}.json`), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

/**
 * Peak-memory ceilings for synthetic corpora (ADR-009 step 5), by file count. Memory must stay bounded as the
 * repository grows: the gate fails a change that brings back whole-run state.
 */
export const SYNTHETIC_BUDGETS: Readonly<Record<number, { readonly maxWallMs: number; readonly maxPeakRssMb: number }>> = {
  // Measured 2026-11-04: 2,212 MiB, 115 s on the CI runner (ubuntu-latest); 1,509-1,666 MiB on a 16 GB Windows
  // dev machine. The ceiling is the CI peak plus about 25%.
  10_000: { maxWallMs: 600_000, maxPeakRssMb: 2_800 },
};

/** One fresh analysis of the synthetic corpus of `files` modules, checked against its budgets. */
export async function runSyntheticScale(files: number): Promise<ScaleResult> {
  const budgets = SYNTHETIC_BUDGETS[files];
  if (budgets === undefined) throw new Error(`No synthetic budget for ${files} files (have: ${Object.keys(SYNTHETIC_BUDGETS).join(", ")}).`);
  const corpus = await ensureSyntheticCorpus(CACHE_DIR, files);
  const run = await measure(corpus);
  const result: ScaleResult = {
    name: `synthetic-${files}`,
    commit: undefined,
    ...run,
    budgets,
    withinBudget: run.wallMs <= budgets.maxWallMs && run.peakRssMb <= budgets.maxPeakRssMb && run.filesAnalyzed === files,
  };
  await mkdir(RESULTS_DIR, { recursive: true });
  await writeFile(join(RESULTS_DIR, `scale-${result.name}.json`), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
