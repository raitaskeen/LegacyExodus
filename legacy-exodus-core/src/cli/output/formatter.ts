import type { PluginListReport } from "../commands/plugins";
import type { StatusReport } from "../commands/status";
import type { AnalyzeProjectReport } from "../commands/analyze";
import { detectTerminalCapabilities } from "../presentation/capabilities";
import { SummaryPresenter } from "../presentation/summaries";

export function formatStatusOutput(report: StatusReport, options: { readonly plain?: boolean } = {}): string {
  const capabilities = detectTerminalCapabilities(options);
  const presenter = new SummaryPresenter(capabilities);
  return presenter.formatStatus(report);
}

export function formatPluginListOutput(report: PluginListReport, options: { readonly plain?: boolean } = {}): string {
  const capabilities = detectTerminalCapabilities(options);
  const presenter = new SummaryPresenter(capabilities);
  return presenter.formatPlugins(report);
}

export function formatAnalyzeOutput(report: AnalyzeProjectReport, options: { readonly plain?: boolean } = {}): string {
  const capabilities = detectTerminalCapabilities(options);
  const presenter = new SummaryPresenter(capabilities);
  return presenter.formatAnalyze(report);
}

export function formatInitOutput(report: import("../commands/init").InitReport, options: { readonly plain?: boolean } = {}): string {
  const capabilities = detectTerminalCapabilities(options);
  const presenter = new SummaryPresenter(capabilities);
  return presenter.formatInit(report);
}
