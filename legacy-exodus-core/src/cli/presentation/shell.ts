import type { TerminalCapabilities } from "./capabilities";
import { createSymbols, type Symbols } from "./symbols";
import { createTheme, stripAnsi, type Theme } from "./theme";
import type { KeyValueItem } from "./layout";

export type StageStatus = "pending" | "running" | "done" | "warn" | "fail" | "skip";

export interface PipelineStage {
  readonly name: string;
  readonly status: StageStatus;
  readonly detail?: string;
  readonly durationMs?: number;
}

export class CliShell {
  public readonly theme: Theme;
  public readonly symbols: Symbols;

  public constructor(public readonly capabilities: TerminalCapabilities) {
    this.theme = createTheme(capabilities);
    this.symbols = createSymbols(capabilities);
  }

  public renderHeader(title: string, subtitle?: string): string {
    const brandPart = `${this.theme.brand(this.symbols.brand)} ${this.theme.heading("LegacyExodus")}`;
    const subPart = subtitle ? ` ${this.theme.muted(this.symbols.arrow)} ${this.theme.text(subtitle)}` : "";
    const titlePart = ` ${this.theme.muted(this.symbols.arrow)} ${this.theme.heading(title)}`;

    const prefix = subtitle ? `${brandPart}${subPart}${titlePart} ` : `${brandPart}${titlePart} `;
    const rawLen = stripAnsi(prefix).length;
    const targetWidth = Math.min(Math.max(this.capabilities.width, 40), 120);
    const remaining = Math.max(0, targetWidth - rawLen);
    const rule = this.theme.border(this.symbols.horizontalRule.repeat(remaining));

    return `${prefix}${rule}`;
  }

  public renderDivider(): string {
    const len = Math.min(Math.max(this.capabilities.width, 40), 120);
    return this.theme.border(this.symbols.horizontalRule.repeat(len));
  }

  public renderStageList(stages: readonly PipelineStage[], indent = 2): string {
    if (stages.length === 0) return "";

    const padStr = " ".repeat(indent);
    const maxNameLen = Math.max(...stages.map((s) => s.name.length));

    return stages.map((stage, idx) => {
      const isLast = idx === stages.length - 1;
      const branch = isLast ? this.symbols.treeCorner : this.symbols.treeBranch;

      let statusIcon = this.theme.muted(this.symbols.stagePending);
      let statusColor = (t: string) => this.theme.muted(t);

      if (stage.status === "running") {
        statusIcon = this.theme.active(this.symbols.stageRunning);
        statusColor = (t: string) => this.theme.active(t);
      } else if (stage.status === "done") {
        statusIcon = this.theme.success(this.symbols.success);
        statusColor = (t: string) => this.theme.text(t);
      } else if (stage.status === "warn") {
        statusIcon = this.theme.warning(this.symbols.warning);
        statusColor = (t: string) => this.theme.warning(t);
      } else if (stage.status === "fail") {
        statusIcon = this.theme.error(this.symbols.failure);
        statusColor = (t: string) => this.theme.error(t);
      } else if (stage.status === "skip") {
        statusIcon = this.theme.muted(this.symbols.stageSkipped);
        statusColor = (t: string) => this.theme.muted(t);
      }

      const paddedName = stage.name.padEnd(maxNameLen, " ");
      const nameText = statusColor(paddedName);
      const detailText = stage.detail ? `  ${this.theme.muted(stage.detail)}` : "";
      const durText = stage.durationMs !== undefined ? ` ${this.theme.dim(`(${stage.durationMs.toFixed(0)}ms)`)}` : "";

      return `${padStr}${branch}${statusIcon} ${nameText}${detailText}${durText}`;
    }).join("\n");
  }

  public renderCard(items: readonly KeyValueItem[], indent = 2): string {
    if (items.length === 0) return "";

    const maxLabelLen = Math.max(...items.map((i) => i.label.length));
    const padStr = " ".repeat(indent);

    const lines = items.map((item) => {
      const paddedLabel = item.label.padEnd(maxLabelLen, " ");
      const labelText = this.theme.muted(paddedLabel);
      let valueText = this.theme.text(String(item.value));

      if (item.badge) {
        let badgeStyled = item.badge;
        if (item.badgeType === "success") badgeStyled = this.theme.success(item.badge);
        else if (item.badgeType === "warning") badgeStyled = this.theme.warning(item.badge);
        else if (item.badgeType === "error") badgeStyled = this.theme.error(item.badge);
        else if (item.badgeType === "info") badgeStyled = this.theme.info(item.badge);
        else if (item.badgeType === "muted") badgeStyled = this.theme.muted(item.badge);

        valueText = `${valueText} ${badgeStyled}`;
      }

      return `${padStr}${labelText}   ${valueText}`;
    });

    return lines.join("\n");
  }

  public renderFooter(message: string, isHealthy = true, indent = 2): string {
    const padStr = " ".repeat(indent);
    const symbol = isHealthy ? this.theme.success(this.symbols.success) : this.theme.warning(this.symbols.warning);
    const text = isHealthy ? this.theme.text(message) : this.theme.warning(message);
    return `${padStr}${symbol} ${text}`;
  }
}
