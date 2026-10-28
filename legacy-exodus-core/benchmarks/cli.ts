/**
 * Phase 3A — Unified Benchmark CLI Entry Point
 *
 * Single deterministic CLI orchestrating all benchmark operations:
 *   - run       : Run single manifest, tier, or full corpus
 *   - compare   : Compare two benchmark runs (regression detection)
 *   - report    : Generate Markdown and JSON summary reports
 *   - audit     : Run benchmark system self-audit (non-zero exit unless every check passes)
 *   - validate  : Run mathematical accounting and completeness gate on a target
 *
 * Usage:
 *   bun run benchmarks/cli.ts run <manifest-or-dir> [--runs N]
 *   bun run benchmarks/cli.ts compare <runA.json> <runB.json>
 *   bun run benchmarks/cli.ts report [--results-dir <dir>] [--output <file>]
 *   bun run benchmarks/cli.ts audit [--root <package-dir>] [--json]
 *   bun run benchmarks/cli.ts validate <target>
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { runBenchmark } from "./runner";
import { compareBenchmarkRuns, formatComparisonMarkdown } from "./compare";
import { isAuditPassing, runBenchmarkSelfAudit } from "./audit";
import { executeBenchmarkRun } from "./harness";
import { generateMarkdownReport } from "./scripts/report";
import { runFidelityValidation } from "./fidelity/runner";
import { BENCHMARKS_ROOT, CORPUS_DIR, RESULTS_DIR, resolveBenchmarkRepoPath, resolveResultsDir } from "./paths";
import type { BenchmarkResult } from "./types";
import { detectTerminalCapabilities } from "../src/cli/presentation/capabilities";
import { ErrorPresenter } from "../src/cli/presentation/errors";
import { LayoutRenderer } from "../src/cli/presentation/layout";
import { VerificationPresenter } from "../src/cli/presentation/verification";

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

    case "fidelity": {
      const target = args[1] ?? resolve(BENCHMARKS_ROOT, ".cache/fastify");
      const resolvedTarget = resolveBenchmarkRepoPath(target);
      console.log(`Running migration fidelity validation for: ${resolvedTarget}`);
      const report = await runFidelityValidation({ repoPath: resolvedTarget });
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
