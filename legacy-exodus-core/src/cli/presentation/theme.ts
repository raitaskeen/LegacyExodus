import type { TerminalCapabilities } from "./capabilities";

export interface Theme {
  readonly brand: (text: string) => string;
  readonly heading: (text: string) => string;
  readonly text: (text: string) => string;
  readonly muted: (text: string) => string;
  readonly border: (text: string) => string;
  readonly success: (text: string) => string;
  readonly warning: (text: string) => string;
  readonly error: (text: string) => string;
  readonly info: (text: string) => string;
  readonly active: (text: string) => string;
  readonly bold: (text: string) => string;
  readonly dim: (text: string) => string;
}

const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";
const ANSI_DIM = "\x1b[2m";

// 24-bit TrueColor sequences with fallback
const COLOR_SKY = "\x1b[38;2;56;189;248m";    // #38BDF8 - Brand / Accent
const COLOR_WHITE = "\x1b[38;2;241;245;249m"; // #F1F5F9 - Text
const COLOR_SLATE = "\x1b[38;2;100;116;139m"; // #64748B - Muted
const COLOR_DARK = "\x1b[38;2;71;85;105m";    // #475569 - Border
const COLOR_EMERALD = "\x1b[38;2;52;211;153m";// #34D399 - Success
const COLOR_AMBER = "\x1b[38;2;251;191;36m";  // #FBBF24 - Warning
const COLOR_RED = "\x1b[38;2;248;113;113m";   // #F87171 - Error
const COLOR_BLUE = "\x1b[38;2;96;165;250m";   // #60A5FA - Active / Info

function wrapAnsi(text: string, open: string, close = ANSI_RESET): string {
  if (text.length === 0) return text;
  return `${open}${text}${close}`;
}

export function stripAnsi(text: string): string {
  // Matches all ANSI escape sequences
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

export function createTheme(capabilities: TerminalCapabilities): Theme {
  const isColorDisabled = capabilities.noColor || capabilities.mode === "plain" || capabilities.mode === "json";

  if (isColorDisabled) {
    const identity = (text: string) => text;
    return {
      brand: identity,
      heading: identity,
      text: identity,
      muted: identity,
      border: identity,
      success: identity,
      warning: identity,
      error: identity,
      info: identity,
      active: identity,
      bold: identity,
      dim: identity,
    };
  }

  return {
    brand: (t: string) => wrapAnsi(t, `${ANSI_BOLD}${COLOR_SKY}`),
    heading: (t: string) => wrapAnsi(t, `${ANSI_BOLD}${COLOR_WHITE}`),
    text: (t: string) => wrapAnsi(t, COLOR_WHITE),
    muted: (t: string) => wrapAnsi(t, COLOR_SLATE),
    border: (t: string) => wrapAnsi(t, COLOR_DARK),
    success: (t: string) => wrapAnsi(t, `${ANSI_BOLD}${COLOR_EMERALD}`),
    warning: (t: string) => wrapAnsi(t, `${ANSI_BOLD}${COLOR_AMBER}`),
    error: (t: string) => wrapAnsi(t, `${ANSI_BOLD}${COLOR_RED}`),
    info: (t: string) => wrapAnsi(t, COLOR_BLUE),
    active: (t: string) => wrapAnsi(t, `${ANSI_BOLD}${COLOR_BLUE}`),
    bold: (t: string) => wrapAnsi(t, ANSI_BOLD),
    dim: (t: string) => wrapAnsi(t, ANSI_DIM),
  };
}
