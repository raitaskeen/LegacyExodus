import type { TerminalCapabilities } from "./capabilities";

export interface Symbols {
  readonly success: string;
  readonly failure: string;
  readonly warning: string;
  readonly info: string;
  readonly arrow: string;
  readonly bullet: string;
  readonly brand: string;
  readonly treeBranch: string;
  readonly treeCorner: string;
  readonly horizontalRule: string;
  readonly progressFilled: string;
  readonly progressEmpty: string;
  readonly spinnerFrames: readonly string[];
}

const UNICODE_SYMBOLS: Symbols = {
  success: "✓",
  failure: "✗",
  warning: "⚠",
  info: "ℹ",
  arrow: "›",
  bullet: "•",
  brand: "◈",
  treeBranch: "├── ",
  treeCorner: "└── ",
  horizontalRule: "─",
  progressFilled: "█",
  progressEmpty: "░",
  spinnerFrames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
};

const ASCII_SYMBOLS: Symbols = {
  success: "[+]",
  failure: "[x]",
  warning: "[!]",
  info: "[i]",
  arrow: ">",
  bullet: "-",
  brand: "*",
  treeBranch: "|-- ",
  treeCorner: "'-- ",
  horizontalRule: "-",
  progressFilled: "#",
  progressEmpty: "-",
  spinnerFrames: ["/", "-", "\\", "|"],
};

export function createSymbols(capabilities: TerminalCapabilities): Symbols {
  if (!capabilities.isUnicodeSupported || capabilities.mode === "plain") {
    return ASCII_SYMBOLS;
  }
  return UNICODE_SYMBOLS;
}
