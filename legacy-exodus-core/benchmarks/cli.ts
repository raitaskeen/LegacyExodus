/**
 * Phase 3A — Unified Benchmark CLI Entry Point
 *
 * Single deterministic CLI orchestrating all benchmark operations:
 *   - run       : Run single manifest, tier, or full corpus
 *   - compare   : Compare two benchmark runs (regression detection)
 *   - report    : Generate Markdown and JSON summary reports
 *   - audit     : Run benchmark system self-audit (non-zero exit unless every check passes)
 *   - validate  : Run mathematical accounting and completeness gate on a target
 *   - fact-diff : Compare the projected facts of two engines (or two .discovery dirs)
 *
 * Usage:
 *   bun run benchmarks/cli.ts run <manifest-or-dir> [--runs N]
 *   bun run benchmarks/cli.ts compare <runA.json> <runB.json>
 *   bun run benchmarks/cli.ts report [--results-dir <dir>] [--output <file>]
 *   bun run benchmarks/cli.ts audit [--root <package-dir>] [--json]
 *   bun run benchmarks/cli.ts validate <target> [--cache-dir <dir>]
 *   bun run benchmarks/cli.ts fidelity [target] [--cache-dir <dir>]
 *   bun run benchmarks/cli.ts fact-diff --base <core-dir> --head <core-dir> <corpus-dir>... [--output <file>] [--fail-on-loss]
 *   bun run benchmarks/cli.ts fact-diff --base-discovery <dir> --head-discovery <dir> [--output <file>] [--fail-on-loss]
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { runBenchmark } from "./runner";
import { compareBenchmarkRuns, formatComparisonMarkdown } from "./compare";
import { isAuditPassing, runBenchmarkSelfAudit } from "./audit";
import { executeBenchmarkRun } from "./harness";
import { analyzeWith, diffFacts, extractFacts, formatCoverage, formatFactDiff, runFactDiff, type CorpusDiff } from "./fact-diff";
import { formatOracle, runCallOracle } from "./call-oracle";
import { formatFlowOracle, runFlowOracle } from "./flow-oracle";
import { generateMarkdownReport } from "./scripts/report";
import { runFidelityValidation } from "./fidelity/runner";
import { ensureCacheEntryVerified } from "./scripts/acquire";
import { BENCHMARKS_ROOT, CORPUS_DIR, RESULTS_DIR, resolveBenchmarkRepoPath, resolveResultsDir } from "./paths";
import type { BenchmarkResult } from "./types";
import { detectTerminalCapabilities } from "../src/cli/presentation/capabilities";
import { ErrorPresenter } from "../src/cli/presentation/errors";
import { LayoutRenderer } from "../src/cli/presentation/layout";
import { VerificationPresenter } from "../src/cli/presentation/verification";
import { runScaleBenchmark, runSyntheticScale } from "./scale";
import { evaluateCases, formatAccuracy } from "./accuracy";
import { conformanceCases } from "../tests/conformance/cases";
import { knownGaps } from "../tests/conformance/known-gaps";
import { createLegacyExodusEngine } from "../src/runtime/composition/services";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? "help";

  switch (command) {
    case "run": {
      const target = args[1];
      if (!target) {
        console.error("Error: Missing target manifest or directory path.");
        console.error("Usage: bun run benchmarks/cli.ts run <manifest-or-tier-dir> [--runs N]");
        process.exit(1);
      }
      const runs = getIntArg(args, "--runs", 3);
      const resolvedTarget = resolveBenchmarkRepoPath(target);

      if (target === "all" || target === "corpus") {
        await runAllCorpus(CORPUS_DIR, runs);
      } else {
        const stats = await statSafe(resolvedTarget);
        if (stats?.isDirectory()) {
          const files = (await readdir(resolvedTarget)).filter((f) => f.endsWith(".json"));
          for (const file of files) {
            await runBenchmark({ target: join(resolvedTarget, file), runs });
          }
        } else {
          await runBenchmark({ target: resolvedTarget, runs });
        }
      }
      break;
    }

    case "compare": {
      const pathA = args[1];
      const pathB = args[2];
      if (!pathA || !pathB) {
        console.error("Error: Missing run artifact paths.");
        console.error("Usage: bun run benchmarks/cli.ts compare <baseline.json> <current.json>");
        process.exit(1);
      }
      const runA = JSON.parse(await readFile(resolve(pathA), "utf8")) as BenchmarkResult;
      const runB = JSON.parse(await readFile(resolve(pathB), "utf8")) as BenchmarkResult;

      const report = compareBenchmarkRuns(runA, runB);
      console.log(formatComparisonMarkdown(report));
      break;
    }

    case "report": {
      const resultsDir = resolveResultsDir(getArgValue(args, "--results-dir"));
      const outputPath = resolve(getArgValue(args, "--output") ?? resolve(BENCHMARKS_ROOT, "BENCHMARK_REPORT.md"));

      const reportMd = await generateMarkdownReport(resultsDir);
      await writeFile(outputPath, reportMd, "utf8");
      console.log(`\n✓ Consolidated Benchmark Report written to: ${outputPath}\n`);
      break;
    }

    case "audit": {
      const root = getArgValue(args, "--root");
      const auditReport = await runBenchmarkSelfAudit(root === undefined ? undefined : resolve(root));

      if (args.includes("--json")) {
        console.log(JSON.stringify(auditReport));
      } else {
        const capabilities = detectTerminalCapabilities();
        const presenter = new VerificationPresenter(capabilities);

        console.log(presenter.renderBenchmarkAudit(auditReport));

        if (auditReport.findings.length > 0) {
          console.log(`\nFindings:`);
          for (const f of auditReport.findings) {
            console.log(`  [${f.severity}] ${f.category}: ${f.description}`);
            console.log(`    Evidence: ${f.evidence}`);
            if (f.remediation) console.log(`    Remediation: ${f.remediation}`);
          }
        }
      }

      // Gate: any failed or unrunnable check fails the audit. exitCode (not exit()) lets stdout flush.
      if (!isAuditPassing(auditReport)) process.exitCode = 1;
      break;
    }

    case "validate": {
      const target = args[1];
      if (!target) {
        console.error("Usage: bun run benchmarks/cli.ts validate <target-path>");
        process.exit(1);
      }
      const capabilities = detectTerminalCapabilities();
      const layout = new LayoutRenderer(capabilities);
      const resolvedTarget = resolveBenchmarkRepoPath(target);
      // A target inside the benchmark cache is a corpus checkout: verify it before analyzing it (BA-20 / A6).
      await ensureCacheEntryVerified(resolvedTarget, getArgValue(args, "--cache-dir"));
      const runRes = await executeBenchmarkRun(resolvedTarget, 0);

      const header = layout.renderHeader("Benchmark Accounting Validation", basename(target));
      const card = layout.renderCard([
        { label: "Target Workspace", value: target },
        { label: "Files Discovered", value: runRes.fileAccounting.filesDiscovered },
        { label: "Computed Total", value: runRes.fileAccounting.computedTotal },
        {
          label: "Reconciliation",
          value: runRes.fileAccounting.reconciles ? "Reconciled" : `Discrepancy: ${runRes.fileAccounting.discrepancy}`,
          badge: runRes.fileAccounting.reconciles ? "PASS" : "FAIL",
          badgeType: runRes.fileAccounting.reconciles ? "success" : "error",
        },
        {
          label: "Completeness",
          value: runRes.completeness.status,
          badge: runRes.completeness.status === "COMPLETE" ? "PASS" : "NEEDS_REVIEW",
          badgeType: runRes.completeness.status === "COMPLETE" ? "success" : "warning",
        },
      ]);
      const divider = layout.renderDivider();
      console.log([header, "", card, "", divider].join("\n"));
      if (!runRes.fileAccounting.reconciles) process.exit(1);
      break;
    }

    case "scale": {
      const name = args[1];
      if (!name) {
        console.error("Usage: bun run benchmarks/cli.ts scale <name> | scale synthetic <files> [--reuse]");
        process.exit(1);
      }
      const result = name === "synthetic" ? await runSyntheticScale(Number(args[2] ?? "10000"), args.includes("--reuse") ? "reuse" : "fresh") : await runScaleBenchmark(name);
      console.log(`${result.name} @ ${result.commit ?? "?"}: ${result.filesAnalyzed}/${result.filesDiscovered} files, ${(result.wallMs / 1000).toFixed(1)} s (budget ${(result.budgets.maxWallMs / 1000).toFixed(0)} s), peak ${result.peakRssMb} MiB (budget ${result.budgets.maxPeakRssMb} MiB)`);
      if (!result.withinBudget) {
        console.error("Scale budget exceeded.");
        process.exit(1);
      }
      break;
    }
    case "coverage": {
      // Phase A2: calls with a proven target and the reasons for the rest, per corpus, with this engine.
      const valuedFlags = new Set(["--output"]);
      const corpora = args.slice(1).filter((arg, index, rest) => !arg.startsWith("--") && !valuedFlags.has(rest[index - 1] ?? ""));
      if (corpora.length === 0) {
        console.error("Usage: bun run benchmarks/cli.ts coverage <corpus-dir>... [--output <file>]");
        process.exit(1);
      }
      const engine = resolve(import.meta.dir, "..");
      const sections = corpora.flatMap((corpus) => [`## ${corpus}`, "", ...formatCoverage(analyzeWith(engine, corpus).coverage)]);
      const markdown = ["# Call coverage", "", ...sections].join("\n");
      const output = getArgValue(args, "--output");
      if (output !== undefined) await writeFile(resolve(output), markdown, "utf8");
      console.log(markdown);
      break;
    }
    case "flow-oracle": {
      // Phase A4: run a pinned corpus's own tests under V8 coverage; check unreachable and dead-code claims.
      const corpora = args.slice(1).filter((arg, index, rest) => !arg.startsWith("--") && rest[index - 1] !== "--output");
      if (corpora.length === 0) {
        console.error("Usage: bun run benchmarks/cli.ts flow-oracle <corpus-dir>... [--output <file>] [--fail-on-contradiction]");
        process.exit(1);
      }
      const engine = resolve(import.meta.dir, "..");
      const results = corpora.map((corpus) => runFlowOracle(engine, corpus));
      const markdown = ["# Flow oracle", "", ...results.map(formatFlowOracle)].join("\n");
      const output = getArgValue(args, "--output");
      if (output !== undefined) await writeFile(resolve(output), markdown, "utf8");
      console.log(markdown);
      if (args.includes("--fail-on-contradiction") && results.some((result) => result.contradictions.length > 0)) process.exitCode = 1;
      break;
    }
    case "call-oracle": {
      // Phase A3: run a pinned corpus's own tests with every function instrumented and check the engine's calls.
      const corpora = args.slice(1).filter((arg, index, rest) => !arg.startsWith("--") && rest[index - 1] !== "--output");
      if (corpora.length === 0) {
        console.error("Usage: bun run benchmarks/cli.ts call-oracle <corpus-dir>... [--output <file>] [--fail-on-contradiction]");
        process.exit(1);
      }
      const engine = resolve(import.meta.dir, "..");
      const results = corpora.map((corpus) => runCallOracle(engine, corpus));
      const markdown = ["# Call oracle", "", ...results.map(formatOracle)].join("\n");
      const output = getArgValue(args, "--output");
      if (output !== undefined) await writeFile(resolve(output), markdown, "utf8");
      console.log(markdown);
      if (args.includes("--fail-on-contradiction") && results.some((result) => result.contradictions.length > 0)) process.exitCode = 1;
      break;
    }
    case "fact-diff": {
      const baseDiscovery = getArgValue(args, "--base-discovery");
      const headDiscovery = getArgValue(args, "--head-discovery");
      let results: readonly CorpusDiff[];
      if (baseDiscovery !== undefined && headDiscovery !== undefined) {
        results = [{ corpus: `${baseDiscovery} vs ${headDiscovery}`, baseMs: 0, headMs: 0, ...diffFacts(extractFacts(resolve(baseDiscovery)), extractFacts(resolve(headDiscovery))) }];
      } else {
        const base = getArgValue(args, "--base");
        const head = getArgValue(args, "--head");
        // Positional arguments are corpora; a value that follows a valued flag belongs to that flag.
        const valuedFlags = new Set(["--base", "--head", "--output"]);
        const corpora = args.slice(1).filter((arg, index, rest) => !arg.startsWith("--") && !valuedFlags.has(rest[index - 1] ?? ""));
        if (base === undefined || head === undefined || corpora.length === 0) {
          console.error("Usage: bun run benchmarks/cli.ts fact-diff --base <core-dir> --head <core-dir> <corpus-dir>... [--output <file>] [--fail-on-loss]");
          process.exit(1);
        }
        results = runFactDiff(base, head, corpora);
      }
      const markdown = formatFactDiff(results);
      const output = getArgValue(args, "--output");
      if (output !== undefined) await writeFile(resolve(output), markdown, "utf8");
      console.log(markdown);
      if (args.includes("--fail-on-loss") && results.some((result) => result.lost > 0)) process.exitCode = 1;
      break;
    }

    case "accuracy": {
      // Recall and precision on the canonical-semantics corpus, by category; fails on any regression.
      const engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });
      await engine.initialize();
      try {
        const results = await evaluateCases(engine, conformanceCases, knownGaps);
        const markdown = formatAccuracy(results);
        const output = getArgValue(args, "--output");
        if (output !== undefined) await writeFile(resolve(output), markdown, "utf8");
        console.log(markdown);
        if (results.some((result) => !result.holds && result.gap === undefined)) process.exitCode = 1;
      } finally {
        await engine.shutdown();
      }
      break;
    }

    case "fidelity": {
      const target = args[1] ?? resolve(BENCHMARKS_ROOT, ".cache/fastify");
      const resolvedTarget = resolveBenchmarkRepoPath(target);
      console.log(`Running migration fidelity validation for: ${resolvedTarget}`);
      const cacheDir = getArgValue(args, "--cache-dir");
      const report = await runFidelityValidation({ repoPath: resolvedTarget, ...(cacheDir === undefined ? {} : { cacheDir }) });
      if (report.overallFalseNegatives > 0 || (report.overallPrecision !== null && report.overallPrecision < 0.9)) {
        console.warn(`\n[FIDELITY WARNING] Found ${report.overallFalseNegatives} False Negatives and ${report.overallFalsePositives} False Positives.`);
      }
      break;
    }

    case "help":
    default:
      printUsage();
      break;
  }
}

async function runAllCorpus(corpusDir: string, runs: number): Promise<void> {
  const tiers = ["tier-1", "tier-2"];
  for (const tier of tiers) {
    const dir = join(corpusDir, tier);
    const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      await runBenchmark({ target: join(dir, f), runs });
    }
  }
}

function printUsage(): void {
  const capabilities = detectTerminalCapabilities();
  const layout = new LayoutRenderer(capabilities);
  const header = layout.renderHeader("Benchmark Intelligence CLI");
  console.log([
    header,
    "",
    "  Commands:",
    "    run <manifest-or-dir> [--runs N]   Execute benchmark runs against targets",
    "    compare <runA.json> <runB.json>    Compare baseline vs current benchmark run",
    "    report [--results-dir D]           Generate consolidated Markdown benchmark report",
    "    audit [--root D] [--json]          Run benchmark self-audit; non-zero exit unless all checks pass",
    "    validate <target-path>             Validate mathematical file accounting on target",
    "    fidelity [target-path]             Validate migration discovery fidelity against ground truth",
    "    fact-diff --base D --head D C...   Diff projected facts of two engines on corpus dirs",
    "    call-oracle <corpus-dir>...        Run a pinned corpus's tests instrumented; check RESOLVED calls",
    "    flow-oracle <corpus-dir>...        Run a pinned corpus's tests under coverage; check unreachable and dead claims",
    "    coverage <corpus-dir>...           Calls with a proven target and the reasons for the rest",
    "    accuracy [--output F]              Recall and precision on the conformance corpus, by category",
    "    scale <name>                       Time and peak memory of a scale corpus against its budgets",
    "    scale synthetic <files>            The same for the synthetic corpus of <files> modules (10000)",
    "    help                               Show this help message",
    "",
    layout.renderDivider(),
  ].join("\n"));
}

function getArgValue(args: readonly string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined;
}

function getIntArg(args: readonly string[], flag: string, defaultValue: number): number {
  const val = getArgValue(args, flag);
  return val ? parseInt(val, 10) : defaultValue;
}

async function statSafe(path: string) {
  try {
    const { stat } = await import("node:fs/promises");
    return await stat(path);
  } catch {
    return null;
  }
}

main().catch((err) => {
  const capabilities = detectTerminalCapabilities({ stream: process.stderr });
  const presenter = new ErrorPresenter(capabilities);
  process.stderr.write(`${presenter.renderError(err)}\n`);
  process.exit(1);
});
