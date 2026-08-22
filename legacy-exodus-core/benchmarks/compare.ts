/**
 * Phase 3A — Performance & Semantic Regression Comparator
 *
 * Compares two benchmark runs (e.g. Current vs Baseline, or Engine A vs Engine B)
 * and classifies every semantic difference and performance delta.
 */

import type {
  BenchmarkResult,
  DifferenceClassification,
  MetricComparison,
  PerformanceStatus,
  RegressionComparisonReport,
} from "./types";

export function compareBenchmarkRuns(
  baseline: BenchmarkResult,
  current: BenchmarkResult,
  tolerancePercent = 10,
): RegressionComparisonReport {
  const warnings: string[] = [];

  // Verify compatibility
  if (baseline.repository.name !== current.repository.name) {
    warnings.push(`Comparing different repositories: ${baseline.repository.name} vs ${current.repository.name}`);
  }
  if (baseline.repository.revision && current.repository.revision && baseline.repository.revision !== current.repository.revision) {
    warnings.push(`Comparing different repository revisions: ${baseline.repository.revision} vs ${current.repository.revision}`);
  }

  const baseRun = baseline.runs[0];
  const currRun = current.runs[0];

  if (!baseRun || !currRun) {
    throw new Error("Benchmark runs missing in baseline or current result");
  }

  const metrics: MetricComparison<number | string | boolean>[] = [];

  // ─── 1. Semantic Metric Comparisons ──────────────────────────────────────────
  const semanticChecks: { key: string; name: string; baseVal: number; currVal: number }[] = [
    { key: "filesAnalyzed", name: "Files Analyzed", baseVal: baseRun.disposition.filesAnalyzed, currVal: currRun.disposition.filesAnalyzed },
    { key: "parserFailures", name: "Parser Failures", baseVal: baseRun.disposition.parserFailures, currVal: currRun.disposition.parserFailures },
    { key: "symbolFailures", name: "Symbol Failures", baseVal: baseRun.disposition.symbolExtractionFailures, currVal: currRun.disposition.symbolExtractionFailures },
    { key: "totalCalls", name: "Total Calls", baseVal: baseRun.semantic.totalCalls, currVal: currRun.semantic.totalCalls },
    { key: "resolvedCalls", name: "Resolved Calls", baseVal: baseRun.semantic.resolvedCalls, currVal: currRun.semantic.resolvedCalls },
    { key: "unresolvedCalls", name: "Unresolved Calls", baseVal: baseRun.semantic.unresolvedCalls, currVal: currRun.semantic.unresolvedCalls },
    { key: "totalSymbols", name: "Total Symbols", baseVal: baseRun.semantic.totalSymbols, currVal: currRun.semantic.totalSymbols },
    { key: "depEdges", name: "Dependency Edges", baseVal: baseRun.semantic.dependencyEdges, currVal: currRun.semantic.dependencyEdges },
    { key: "cfgCount", name: "CFG Count", baseVal: baseRun.flow.cfgCount, currVal: currRun.flow.cfgCount },
    { key: "basicBlocks", name: "Basic Blocks", baseVal: baseRun.flow.basicBlockCount, currVal: currRun.flow.basicBlockCount },
    { key: "controlFlowEdges", name: "CFG Edges", baseVal: baseRun.flow.controlFlowEdgeCount, currVal: currRun.flow.controlFlowEdgeCount },
    { key: "dominators", name: "Dominators", baseVal: baseRun.flow.dominatorRecordCount, currVal: currRun.flow.dominatorRecordCount },
    { key: "dfgCount", name: "DFG Count", baseVal: baseRun.flow.dfgCount, currVal: currRun.flow.dfgCount },
    { key: "definitions", name: "Definitions", baseVal: baseRun.flow.totalDefinitions, currVal: currRun.flow.totalDefinitions },
    { key: "uses", name: "Uses", baseVal: baseRun.flow.totalUses, currVal: currRun.flow.totalUses },
    { key: "defUseChains", name: "Def-Use Chains", baseVal: baseRun.flow.defUseChains, currVal: currRun.flow.defUseChains },
    { key: "taintFlows", name: "Taint Flows", baseVal: baseRun.flow.taintFlows, currVal: currRun.flow.taintFlows },
    { key: "interprocedural", name: "Interprocedural Flows", baseVal: baseRun.flow.interproceduralFlows, currVal: currRun.flow.interproceduralFlows },
    { key: "kgNodes", name: "Knowledge Nodes", baseVal: baseRun.flow.knowledgeNodes, currVal: currRun.flow.knowledgeNodes },
    { key: "kgEdges", name: "Knowledge Edges", baseVal: baseRun.flow.knowledgeEdges, currVal: currRun.flow.knowledgeEdges },
  ];

  let hasSemanticRegression = false;
  let hasSemanticImprovement = false;

  for (const sc of semanticChecks) {
    const delta = sc.currVal - sc.baseVal;
    let classification: DifferenceClassification = "EXPECTED";

    if (delta === 0) {
      classification = "EXPECTED";
    } else if (sc.key === "parserFailures" || sc.key === "symbolFailures") {
      classification = delta < 0 ? "IMPROVEMENT" : "REGRESSION";
    } else if (sc.key === "resolvedCalls") {
      classification = delta > 0 ? "IMPROVEMENT" : "REGRESSION";
    } else {
      // In general, dropping symbols, CFGs, or DFGs is suspicious
      classification = delta < 0 ? "REGRESSION" : "IMPROVEMENT";
    }

    if (classification === "REGRESSION") hasSemanticRegression = true;
    if (classification === "IMPROVEMENT") hasSemanticImprovement = true;

    metrics.push({
      metric: sc.name,
      baselineValue: sc.baseVal,
      currentValue: sc.currVal,
      delta: delta > 0 ? `+${delta}` : `${delta}`,
      classification,
    });
  }

  // ─── 2. Performance Comparisons ──────────────────────────────────────────────
  const basePerf = baseline.performance;
  const currPerf = current.performance;

  const perfDeltaMs = currPerf.avgDurationMs - basePerf.avgDurationMs;
  const percentChange = basePerf.avgDurationMs === 0 ? 0 : ((currPerf.avgDurationMs - basePerf.avgDurationMs) / basePerf.avgDurationMs) * 100;

  let overallPerfStatus: PerformanceStatus = "STABLE";
  if (percentChange < -tolerancePercent) {
    overallPerfStatus = "IMPROVED";
  } else if (percentChange > tolerancePercent * 1.5) {
    overallPerfStatus = "REGRESSED";
  } else {
    overallPerfStatus = "STABLE";
  }

  metrics.push({
    metric: "Average Duration (ms)",
    baselineValue: basePerf.avgDurationMs,
    currentValue: currPerf.avgDurationMs,
    delta: perfDeltaMs.toFixed(1),
    percentDelta: percentChange,
    classification: percentChange < -tolerancePercent ? "IMPROVEMENT" : percentChange > tolerancePercent * 1.5 ? "REGRESSION" : "EXPECTED",
  });

  metrics.push({
    metric: "Files / Second",
    baselineValue: basePerf.filesPerSecond.toFixed(1),
    currentValue: currPerf.filesPerSecond.toFixed(1),
    classification: currPerf.filesPerSecond > basePerf.filesPerSecond ? "IMPROVEMENT" : "EXPECTED",
  });

  const overallSemanticStatus: DifferenceClassification = hasSemanticRegression
    ? "REGRESSION"
    : hasSemanticImprovement
    ? "IMPROVEMENT"
    : "EXPECTED";

  return {
    baselineRunId: baseline.id,
    currentRunId: current.id,
    repository: current.repository.name,
    overallPerformanceStatus: overallPerfStatus,
    overallSemanticStatus,
    metrics,
    warnings,
  };
}

export function formatComparisonMarkdown(report: RegressionComparisonReport): string {
  const lines: string[] = [];
  lines.push(`## Benchmark Comparison: ${report.repository}`);
  lines.push("");
  lines.push(`- **Baseline Run ID**: \`${report.baselineRunId}\``);
  lines.push(`- **Current Run ID**: \`${report.currentRunId}\``);
  lines.push(`- **Semantic Status**: **${report.overallSemanticStatus}**`);
  lines.push(`- **Performance Status**: **${report.overallPerformanceStatus}**`);
  lines.push("");

  if (report.warnings.length > 0) {
    lines.push("> [!WARNING]");
    for (const w of report.warnings) lines.push(`> ${w}`);
    lines.push("");
  }

  lines.push("| Metric | Baseline | Current | Delta | Classification |");
  lines.push("|---|---:|---:|---:|:---:|");

  for (const m of report.metrics) {
    const deltaStr = m.percentDelta !== undefined ? `${m.delta} (${m.percentDelta.toFixed(1)}%)` : `${m.delta ?? "-"}`;
    lines.push(`| ${m.metric} | ${m.baselineValue} | ${m.currentValue} | ${deltaStr} | ${m.classification} |`);
  }

  lines.push("");
  return lines.join("\n");
}
