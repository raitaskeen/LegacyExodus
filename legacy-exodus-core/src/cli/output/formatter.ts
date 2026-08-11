import type { PluginListReport } from "../commands/plugins";
import type { StatusReport } from "../commands/status";
import type { AnalyzeProjectReport } from "../commands/analyze";

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

export function formatAnalyzeOutput(report: AnalyzeProjectReport): string {
  return [
    "Discovery completed",
    "",
    `Project: ${report.projectName}`,
    `Files: ${report.files}`,
    `Languages: ${report.languages.join(", ") || "none"}`,
    `Frameworks: ${report.frameworks.join(", ") || "none"}`,
    `Dependencies: ${report.dependencies}`,
  ].join("\n");
}
