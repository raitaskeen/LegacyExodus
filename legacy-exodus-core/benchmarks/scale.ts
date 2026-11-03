/**
 * Scale benchmark (Wave 3d, BA-28 / BA-17): one full analysis of a `scale` tier corpus, with its wall
 * time and the process's peak resident memory checked against the manifest's budgets. Run on request:
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

/** Peak resident memory of this process so far, in MiB (`maxRSS` is in KiB). */
function peakRssMb(): number {
  return Math.round((process.resourceUsage().maxRSS / 1024) * 10) / 10;
}

export async function runScaleBenchmark(name: string): Promise<ScaleResult> {
  const manifest = await findCorpusManifest(name);
  if (manifest === null) throw new Error(`No corpus manifest named '${name}'.`);
  if (manifest.tier !== "scale" || manifest.budgets === undefined) throw new Error(`'${name}' is not a scale benchmark with budgets.`);

  const checkout = join(CACHE_DIR, manifest.name);
  await ensureCorpusCheckout(checkout);

  const started = performance.now();
  const run = await executeBenchmarkRun(checkout, 0);
  const wallMs = Math.round(performance.now() - started);
  const peak = Math.max(peakRssMb(), run.peakRssMb);

  const result: ScaleResult = {
    name: manifest.name,
    commit: manifest.commit,
    wallMs,
    peakRssMb: peak,
    filesDiscovered: run.disposition.filesDiscovered,
    filesAnalyzed: run.disposition.filesAnalyzed,
    budgets: manifest.budgets,
    withinBudget: wallMs <= manifest.budgets.maxWallMs && peak <= manifest.budgets.maxPeakRssMb,
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
  // Measured 2026-11-04: 1,509-1,666 MiB, 131-382 s on a 16 GB Windows dev machine.
  10_000: { maxWallMs: 600_000, maxPeakRssMb: 2_048 },
};

/** One fresh analysis of the synthetic corpus of `files` modules, checked against its budgets. */
export async function runSyntheticScale(files: number): Promise<ScaleResult> {
  const budgets = SYNTHETIC_BUDGETS[files];
  if (budgets === undefined) throw new Error(`No synthetic budget for ${files} files (have: ${Object.keys(SYNTHETIC_BUDGETS).join(", ")}).`);
  const corpus = await ensureSyntheticCorpus(CACHE_DIR, files);
  // A snapshot from an earlier run would be reused instead of analysed.
  await rm(join(corpus, ".discovery"), { recursive: true, force: true });

  const started = performance.now();
  const run = await executeBenchmarkRun(corpus, 0);
  const wallMs = Math.round(performance.now() - started);
  const peak = Math.max(peakRssMb(), run.peakRssMb);
  const result: ScaleResult = {
    name: `synthetic-${files}`,
    commit: undefined,
    wallMs,
    peakRssMb: peak,
    filesDiscovered: run.disposition.filesDiscovered,
    filesAnalyzed: run.disposition.filesAnalyzed,
    budgets,
    withinBudget: wallMs <= budgets.maxWallMs && peak <= budgets.maxPeakRssMb && run.disposition.filesAnalyzed === files,
  };
  await mkdir(RESULTS_DIR, { recursive: true });
  await writeFile(join(RESULTS_DIR, `scale-${result.name}.json`), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
