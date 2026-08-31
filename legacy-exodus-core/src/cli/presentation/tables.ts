import type { TerminalCapabilities } from "./capabilities";
import { createSymbols, type Symbols } from "./symbols";
import { createTheme, stripAnsi, type Theme } from "./theme";

export interface TableColumn {
  readonly key: string;
  readonly header: string;
  readonly align?: "left" | "right" | "center";
  readonly minWidth?: number;
}

const ANSI_RESET = "\x1b[0m";

export function truncateAnsi(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  const plain = stripAnsi(text);
  if (plain.length <= maxWidth) return text;

  if (maxWidth <= 3) {
    return plain.slice(0, maxWidth);
  }

  const targetLen = maxWidth - 3;
  if (plain === text) {
    return `${text.slice(0, targetLen)}...`;
  }

  let visibleCount = 0;
  let result = "";
  let inEscape = false;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\x1b") {
      inEscape = true;
      result += text[i];
    } else if (inEscape) {
      result += text[i];
      if (text[i] === "m") {
        inEscape = false;
      }
    } else {
      if (visibleCount < targetLen) {
        result += text[i];
        visibleCount++;
      } else {
        break;
      }
    }
  }

  return `${result}...${ANSI_RESET}`;
}

export class TableRenderer {
  public readonly theme: Theme;
  public readonly symbols: Symbols;

  public constructor(public readonly capabilities: TerminalCapabilities) {
    this.theme = createTheme(capabilities);
    this.symbols = createSymbols(capabilities);
  }

  public renderTable<T extends object>(
    columns: readonly TableColumn[],
    rows: readonly T[],
    indent = 2,
  ): string {
    if (rows.length === 0) {
      return `${" ".repeat(indent)}${this.theme.muted("No data to display.")}`;
    }

    const padStr = " ".repeat(indent);
    const colWidths = this.computeColumnWidths(columns, rows, indent);

    // Header row
    const headerParts = columns.map((col) => {
      const width = colWidths[col.key] ?? col.header.length;
      return this.formatCell(col.header, width, col.align ?? "left");
    });
    const headerLine = `${padStr}${this.theme.heading(headerParts.join("  "))}`;

    // Separator rule
    const sepParts = columns.map((col) => {
      const width = colWidths[col.key] ?? col.header.length;
      return this.symbols.horizontalRule.repeat(width);
    });
    const sepLine = `${padStr}${this.theme.border(sepParts.join("  "))}`;

    // Data rows
    const rowLines = rows.map((row) => {
      const cellParts = columns.map((col) => {
        const width = colWidths[col.key] ?? col.header.length;
        const valStr = String((row as Record<string, unknown>)[col.key] ?? "");
        return this.formatCell(valStr, width, col.align ?? "left");
      });
      return `${padStr}${cellParts.join("  ")}`;
    });

    return [headerLine, sepLine, ...rowLines].join("\n");
  }

  private computeColumnWidths<T extends object>(
    columns: readonly TableColumn[],
    rows: readonly T[],
    indent: number,
  ): Record<string, number> {
    const K = columns.length;
    if (K === 0) return {};

    const spacing = (K - 1) * 2;
    const terminalWidth = this.capabilities.width && this.capabilities.width > 0 ? this.capabilities.width : 80;
    const availableContentWidth = Math.max(K, terminalWidth - indent - spacing);

    // 1. Natural widths
    const naturalWidths: Record<string, number> = {};
    const minWidths: Record<string, number> = {};

    for (const col of columns) {
      let maxLen = stripAnsi(col.header).length;
      for (const row of rows) {
        const valStr = String((row as Record<string, unknown>)[col.key] ?? "");
        const cleanLen = stripAnsi(valStr).length;
        if (cleanLen > maxLen) {
          maxLen = cleanLen;
        }
      }
      naturalWidths[col.key] = Math.max(col.minWidth ?? 0, maxLen);
      minWidths[col.key] = Math.max(1, Math.min(col.minWidth ?? 4, stripAnsi(col.header).length, 6));
    }

    const totalNatural = Object.values(naturalWidths).reduce((a, b) => a + b, 0);
    if (totalNatural <= availableContentWidth) {
      return naturalWidths;
    }

    // 2. Budget down widest columns iteratively
    const colWidths = { ...naturalWidths };
    let currentTotal = totalNatural;

    const totalMin = Object.values(minWidths).reduce((a, b) => a + b, 0);
    if (totalMin >= availableContentWidth) {
      const uniform = Math.max(1, Math.floor(availableContentWidth / K));
      let rem = availableContentWidth - uniform * K;
      for (const col of columns) {
        colWidths[col.key] = uniform + (rem > 0 ? 1 : 0);
        if (rem > 0) rem--;
      }
      return colWidths;
    }

    while (currentTotal > availableContentWidth) {
      let maxShrinkable = 0;
      for (const col of columns) {
        if (colWidths[col.key]! > minWidths[col.key]!) {
          if (colWidths[col.key]! > maxShrinkable) {
            maxShrinkable = colWidths[col.key]!;
          }
        }
      }

      if (maxShrinkable === 0) break;

      for (const col of columns) {
        if (colWidths[col.key] === maxShrinkable && colWidths[col.key]! > minWidths[col.key]!) {
          colWidths[col.key]!--;
          currentTotal--;
          if (currentTotal <= availableContentWidth) break;
        }
      }
    }

    return colWidths;
  }

  private formatCell(value: string, width: number, align: "left" | "right" | "center"): string {
    const rawLen = stripAnsi(value).length;
    if (rawLen > width) {
      return truncateAnsi(value, width);
    }
    const diff = Math.max(0, width - rawLen);

    if (align === "right") {
      return `${" ".repeat(diff)}${value}`;
    }
    if (align === "center") {
      const leftPad = Math.floor(diff / 2);
      const rightPad = diff - leftPad;
      return `${" ".repeat(leftPad)}${value}${" ".repeat(rightPad)}`;
    }
    return `${value}${" ".repeat(diff)}`;
  }
}
