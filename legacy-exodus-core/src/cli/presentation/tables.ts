import type { TerminalCapabilities } from "./capabilities";
import { createSymbols, type Symbols } from "./symbols";
import { createTheme, stripAnsi, type Theme } from "./theme";

export interface TableColumn {
  readonly key: string;
  readonly header: string;
  readonly align?: "left" | "right" | "center";
  readonly minWidth?: number;
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
    const colWidths: Record<string, number> = {};

    for (const col of columns) {
      let maxLen = col.header.length;
      for (const row of rows) {
        const valStr = String((row as Record<string, unknown>)[col.key] ?? "");
        const cleanLen = stripAnsi(valStr).length;
        if (cleanLen > maxLen) {
          maxLen = cleanLen;
        }
      }
      colWidths[col.key] = Math.max(col.minWidth ?? 0, maxLen);
    }

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

  private formatCell(value: string, width: number, align: "left" | "right" | "center"): string {
    const rawLen = stripAnsi(value).length;
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
