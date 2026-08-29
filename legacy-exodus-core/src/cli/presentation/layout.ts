import type { TerminalCapabilities } from "./capabilities";
import { createSymbols, type Symbols } from "./symbols";
import { createTheme, stripAnsi, type Theme } from "./theme";

export interface KeyValueItem {
  readonly label: string;
  readonly value: string | number | boolean;
  readonly badge?: string;
  readonly badgeType?: "success" | "warning" | "error" | "info" | "muted";
}

export class LayoutRenderer {
  public readonly theme: Theme;
  public readonly symbols: Symbols;

  public constructor(public readonly capabilities: TerminalCapabilities) {
    this.theme = createTheme(capabilities);
    this.symbols = createSymbols(capabilities);
  }

  public renderLogo(full = false): string {
    if (!full || this.capabilities.width < 65 || this.capabilities.mode !== "interactive") {
      return `${this.theme.brand(this.symbols.brand)} ${this.theme.heading("LegacyExodus")} ${this.theme.muted("v0.1.0")}`;
    }

    const lines = [
      "  ██╗     ███████╗ ██████╗  █████╗  ██████╗██╗   ██╗",
      "  ██║     ██╔════╝██╔════╝ ██╔══██╗██╔════╝╚██╗ ██╔╝",
      "  ██║     █████╗  ██║  ███╗███████║██║      ╚████╔╝ ",
      "  ██║     ██╔══╝  ██║   ██║██╔══██║██║       ╚██╔╝  ",
      "  ███████╗███████╗╚██████╔╝██║  ██║╚██████╗   ██║   ",
      "  ╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝   ╚═╝   ",
      "  ███████╗ ██╗  ██╗  ██████╗  ██████╗  ██╗   ██╗ ███████╗",
      "  ██╔════╝ ╚██╗██╔╝ ██╔═══██╗ ██╔══██╗ ██║   ██║ ██╔════╝",
      "  █████╗    ╚███╔╝  ██║   ██║ ██║  ██║ ██║   ██║ ███████╗",
      "  ██╔══╝    ██╔██╗  ██║   ██║ ██║  ██║ ██║   ██║ ╚════██║",
      "  ███████╗ ██╔╝ ██╗ ╚██████╔╝ ██████╔╝ ╚██████╔╝ ███████║",
      "  ╚══════╝ ╚═╝  ╚═╝  ╚═════╝  ╚═════╝   ╚═════╝  ╚══════╝",
      "  v0.1.0",
    ];

    return lines.map((l) => this.theme.brand(l)).join("\n");
  }

  public renderHeader(title: string, subtitle?: string): string {
    const brandPart = `${this.theme.brand(this.symbols.brand)} ${this.theme.heading("LegacyExodus")}`;
    const subPart = subtitle ? ` ${this.theme.muted(this.symbols.arrow)} ${this.theme.text(subtitle)}` : "";
    const titlePart = ` ${this.theme.muted(this.symbols.arrow)} ${this.theme.heading(title)}`;

    const prefix = subtitle ? `${brandPart}${subPart}${titlePart} ` : `${brandPart}${titlePart} `;
    const rawLen = stripAnsi(prefix).length;
    const maxTargetWidth = Math.min(Math.max(this.capabilities.width, 60), 120);
    const remaining = Math.max(0, maxTargetWidth - rawLen);
    const rule = this.theme.border(this.symbols.horizontalRule.repeat(remaining));

    return `${prefix}${rule}`;
  }

  public renderDivider(): string {
    const len = Math.min(Math.max(this.capabilities.width, 60), 120);
    return this.theme.border(this.symbols.horizontalRule.repeat(len));
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

  public renderSection(title: string, content: string): string {
    const heading = `  ${this.theme.heading(title)}`;
    return `${heading}\n${content}`;
  }

  public truncatePath(path: string, maxLength = 45): string {
    if (path.length <= maxLength) return path;
    const half = Math.floor((maxLength - 3) / 2);
    return `${path.slice(0, half)}...${path.slice(path.length - half)}`;
  }
}
