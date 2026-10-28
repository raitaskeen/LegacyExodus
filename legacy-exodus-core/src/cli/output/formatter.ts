import type { PluginListReport } from "../commands/plugins";
import type { StatusReport } from "../commands/status";
import type { AnalyzeProjectReport } from "../commands/analyze";
import type { InitReport } from "../commands/init";

export function formatStatusOutput(report: StatusReport): string {
  return [
    "LegacyExodus Status",
    "",
    `Runtime: ${report.runtime}`,
    `Storage: ${report.storage}`,
    `Plugins: ${report.plugins} loaded`,
    `Version: ${report.version}`,
  ].join("\n");
}

export function formatPluginListOutput(report: PluginListReport): string {
  if (report.plugins.length === 0) {
    return ["Installed Plugins", "", "No plugins registered"].join("\n");
  }

  return ["Installed Plugins", "", ...report.plugins.map((plugin) => plugin.name)].join("\n");
}

export function isCleanAnalyzeReport(report: AnalyzeProjectReport): boolean {
  const enumerationFailures = report.enumerationFailures ?? 0;
  const discoveryComplete = report.discoveryComplete ?? (enumerationFailures === 0);

  return discoveryComplete
    && enumerationFailures === 0
    && report.parserFailures === 0
    && report.symbolExtractionFailures === 0;
}

export function formatAnalyzeOutput(report: AnalyzeProjectReport): string {
  const enumerationFailures = report.enumerationFailures ?? 0;
  const discoveryComplete = report.discoveryComplete ?? (enumerationFailures === 0);
  const isClean = isCleanAnalyzeReport(report);
  return [
    isClean
      ? "Discovery completed"
      : "Analysis completed with isolated non-fatal faults",
    "",
    `Project: ${report.projectName}`,
    `Files discovered: ${report.filesDiscovered}`,
    `Files analyzed: ${report.filesAnalyzed}`,
    `Parser failures: ${report.parserFailures}`,
    `Symbol extraction failures: ${report.symbolExtractionFailures}`,
    `Unsupported source files: ${report.unsupportedFiles}`,
    `Non-source artifacts: ${report.nonSourceArtifacts}`,
    `Unclassified files: ${report.unclassifiedArtifacts}`,
    `Enumeration failures: ${enumerationFailures}`,
    `Discovery complete: ${discoveryComplete ? "yes" : "no"}`,
    ...(report.reused === true ? [formatSnapshotReuse(report)] : []),
    `Analysis duration: ${report.durationMs.toFixed(2)}ms`,
    `Languages: ${report.languages.join(", ") || "none"}`,
    `Frameworks: ${report.frameworks.join(", ") || "none"}`,
    `Dependencies: ${report.dependencies}`,
  ].join("\n");
}

/** Reuse is announced explicitly; fresh analysis output is unchanged. */
export function formatSnapshotReuse(report: AnalyzeProjectReport): string {
  return report.snapshotAnalysisRunId === undefined
    ? "Snapshot reused: yes (pass --refresh for fresh analysis)"
    : `Snapshot reused: yes, from analysis run ${report.snapshotAnalysisRunId} (pass --refresh for fresh analysis)`;
}

export function formatInitOutput(report: InitReport): string {
  return [
    "LegacyExodus workspace initialized",
    `${report.metadataPath}`,
  ].join("\n");
}
