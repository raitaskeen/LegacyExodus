import type { AnalyzeProjectReport } from "../commands/analyze";
import type { InitReport } from "../commands/init";
import type { PluginListReport } from "../commands/plugins";
import type { StatusReport } from "../commands/status";
import {
  formatAnalyzeOutput,
  formatInitOutput,
  formatPluginListOutput,
  formatStatusOutput,
  isCleanAnalyzeReport,
} from "../output/formatter";
import type { TerminalCapabilities } from "./capabilities";
import { LayoutRenderer } from "./layout";
import { TableRenderer } from "./tables";

export class SummaryPresenter {
  private readonly layout: LayoutRenderer;
  private readonly tables: TableRenderer;

  public constructor(public readonly capabilities: TerminalCapabilities) {
    this.layout = new LayoutRenderer(capabilities);
    this.tables = new TableRenderer(capabilities);
  }

  public formatStatus(report: StatusReport): string {
    if (this.capabilities.mode === "plain" || this.capabilities.mode === "ci") {
      return formatStatusOutput(report);
    }

    const logo = this.layout.renderLogo(true);
    const header = this.layout.renderHeader("Runtime Status");
    const card = this.layout.renderCard([
      {
        label: "Engine State",
        value: report.runtime.toUpperCase(),
        badge: report.runtime === "running" ? "ACTIVE" : "IDLE",
        badgeType: report.runtime === "running" ? "success" : "muted",
      },
      {
        label: "Storage Backend",
        value: report.storage === "ready" ? "Ready" : "Not Ready",
        badge: report.storage === "ready" ? "ONLINE" : "OFFLINE",
        badgeType: report.storage === "ready" ? "success" : "error",
      },
      {
        label: "Loaded Plugins",
        value: `${report.plugins} registered`,
      },
      {
        label: "Engine Version",
        value: report.version,
      },
    ]);
    const divider = this.layout.renderDivider();
    const isHealthy = report.runtime === "running" && report.storage === "ready";
    const statusMsg = isHealthy
      ? `  ${this.layout.theme.success(this.layout.symbols.success)} ${this.layout.theme.text("Runtime healthy")}`
      : `  ${this.layout.theme.warning(this.layout.symbols.warning)} ${this.layout.theme.text("Runtime degraded")}`;

    return [logo, "", header, "", card, "", divider, "", statusMsg].join("\n");
  }

  public formatInit(report: InitReport): string {
    if (this.capabilities.mode === "plain" || this.capabilities.mode === "ci") {
      return formatInitOutput(report);
    }

    const header = this.layout.renderHeader("Workspace Initialization");
    const card = this.layout.renderCard([
      { label: "Target Workspace", value: report.workspace },
      { label: "Configuration", value: report.metadataPath },
      { label: "Initialized At", value: report.metadata.createdAt },
      { label: "Schema Version", value: report.metadata.version },
    ]);
    const successMsg = `  ${this.layout.theme.success(this.layout.symbols.success)} ${this.layout.theme.text("Workspace ready for LegacyExodus analysis.")}`;
    const divider = this.layout.renderDivider();

    return [header, "", card, "", successMsg, "", divider].join("\n");
  }

  public formatPlugins(report: PluginListReport): string {
    if (this.capabilities.mode === "plain" || this.capabilities.mode === "ci") {
      return formatPluginListOutput(report);
    }

    const header = this.layout.renderHeader("Plugin Registry");

    if (report.plugins.length === 0) {
      const emptyCard = `  ${this.layout.theme.muted("Installed Plugins (0 total)")}\n  ${this.layout.symbols.treeCorner}${this.layout.theme.muted("No external plugins registered in active runtime.")}`;
      const divider = this.layout.renderDivider();
      return [header, "", emptyCard, "", divider].join("\n");
    }

    const table = this.tables.renderTable(
      [
        { key: "name", header: "Plugin Name" },
        { key: "version", header: "Version" },
        { key: "type", header: "Category" },
        { key: "id", header: "Identifier" },
      ],
      report.plugins,
    );
    const divider = this.layout.renderDivider();

    return [header, "", table, "", divider].join("\n");
  }

  public formatAnalyze(report: AnalyzeProjectReport): string {
    const enumFailures = report.enumerationFailures ?? 0;
    const discoveryComplete = report.discoveryComplete ?? (enumFailures === 0);
    const isClean = isCleanAnalyzeReport(report);

    if (this.capabilities.mode === "plain" || this.capabilities.mode === "ci") {
      return formatAnalyzeOutput(report);
    }

    const header = this.layout.renderHeader("Analysis Summary", report.projectName);

    const overviewCard = this.layout.renderCard([
      { label: "Project Name", value: report.projectName },
      { label: "Analysis Run ID", value: "Verified Active Run" },
      {
        label: "Discovery Complete",
        value: discoveryComplete ? "yes" : "no",
        badge: discoveryComplete ? "COMPLETED" : "NEEDS_REVIEW",
        badgeType: discoveryComplete ? "success" : "warning",
      },
      ...(report.reused === true
        ? [{
          label: "Snapshot",
          value: report.snapshotAnalysisRunId === undefined
            ? "reused (--refresh for fresh analysis)"
            : `reused from run ${report.snapshotAnalysisRunId}`,
          badge: "REUSED",
          badgeType: "warning" as const,
        }]
        : []),
    ]);

    const artifactsTree = [
      `  ${this.layout.theme.heading("Artifact Breakdown")}`,
      `  ${this.layout.theme.muted("Files Discovered".padEnd(26, " "))}${this.layout.theme.text(String(report.filesDiscovered))} total`,
      `  ${this.layout.symbols.treeBranch}${this.layout.theme.muted("Files Analyzed".padEnd(24, " "))}${this.layout.theme.text(String(report.filesAnalyzed))}`,
      `  ${this.layout.symbols.treeBranch}${this.layout.theme.muted("Non-Source Artifacts".padEnd(24, " "))}${this.layout.theme.text(String(report.nonSourceArtifacts))}`,
      `  ${this.layout.symbols.treeBranch}${this.layout.theme.muted("Unsupported Source Files".padEnd(24, " "))}${this.layout.theme.text(String(report.unsupportedFiles))}`,
      `  ${this.layout.symbols.treeCorner}${this.layout.theme.muted("Unclassified Files".padEnd(24, " "))}${this.layout.theme.text(String(report.unclassifiedArtifacts))}`,
    ].join("\n");

    const qualityCard = this.layout.renderCard([
      {
        label: "Parser Failures",
        value: report.parserFailures,
        badge: report.parserFailures === 0 ? "ZERO" : `${report.parserFailures} ISOLATED`,
        badgeType: report.parserFailures === 0 ? "success" : "warning",
      },
      {
        label: "Symbol Extraction Failures",
        value: report.symbolExtractionFailures,
        badge: report.symbolExtractionFailures === 0 ? "ZERO" : `${report.symbolExtractionFailures} ISOLATED`,
        badgeType: report.symbolExtractionFailures === 0 ? "success" : "warning",
      },
      {
        label: "Enumeration Failures",
        value: enumFailures,
        badge: enumFailures === 0 ? "ZERO" : `${enumFailures} FAULTS`,
        badgeType: enumFailures === 0 ? "success" : "error",
      },
      {
        label: "Total Duration",
        value: `${report.durationMs.toFixed(2)} ms`,
      },
    ]);

    const statusBanner = isClean
      ? `  ${this.layout.theme.success(this.layout.symbols.success)} ${this.layout.theme.text("Analysis and graph persistence completed successfully.")}`
      : `  ${this.layout.theme.warning(this.layout.symbols.warning)} ${this.layout.theme.text("Analysis completed with isolated non-fatal faults.")}`;

    const divider = this.layout.renderDivider();

    return [
      header,
      "",
      this.layout.renderSection("Project Overview", overviewCard),
      "",
      artifactsTree,
      "",
      this.layout.renderSection("Quality & Performance", qualityCard),
      "",
      statusBanner,
      "",
      divider,
    ].join("\n");
  }
}
