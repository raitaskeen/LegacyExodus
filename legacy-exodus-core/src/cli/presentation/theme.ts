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
  readonly highlight: (text: string) => string;
}

const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";
const ANSI_DIM = "\x1b[2m";
const ANSI_UNDERLINE = "\x1b[4m";

// 1. Classic Palette (Sky / Slate / Emerald / Amber / Coral)
const CLASSIC_SKY = "\x1b[38;2;56;189;248m";     // #38BDF8 - Brand / Accent
const CLASSIC_WHITE = "\x1b[38;2;241;245;249m";  // #F1F5F9 - Text
const CLASSIC_SLATE = "\x1b[38;2;100;116;139m";  // #64748B - Muted
const CLASSIC_DARK = "\x1b[38;2;71;85;105m";     // #475569 - Border
const CLASSIC_EMERALD = "\x1b[38;2;52;211;153m"; // #34D399 - Success
const CLASSIC_AMBER = "\x1b[38;2;251;191;36m";   // #FBBF24 - Warning
const CLASSIC_RED = "\x1b[38;2;248;113;113m";    // #F87171 - Error
const CLASSIC_BLUE = "\x1b[38;2;96;165;250m";    // #60A5FA - Active / Info

// 2. Aurora Palette (Lavender / Teal / Rose / Peach / Ice)
const AURORA_LAVENDER = "\x1b[38;2;167;139;250m"; // #A78BFA - Brand / Primary
const AURORA_WHITE = "\x1b[38;2;243;244;246m";    // #F3F4F6 - Text
const AURORA_SLATE = "\x1b[38;2;156;163;175m";    // #9CA3AF - Muted
const AURORA_DARK = "\x1b[38;2;107;114;128m";     // #6B7280 - Border
const AURORA_TEAL = "\x1b[38;2;45;212;191m";      // #2DD4BF - Success
const AURORA_PEACH = "\x1b[38;2;252;211;77m";     // #FCD34D - Warning
const AURORA_ROSE = "\x1b[38;2;251;113;133m";     // #FB7185 - Error
const AURORA_ICE = "\x1b[38;2;56;189;248m";       // #38BDF8 - Info
const AURORA_VIOLET = "\x1b[38;2;129;140;248m";   // #818CF8 - Active

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
      highlight: identity,
    };
  }

  if (capabilities.theme === "mono") {
    return {
      brand: (t: string) => wrapAnsi(t, ANSI_BOLD),
      heading: (t: string) => wrapAnsi(t, ANSI_BOLD),
      text: (t: string) => t,
      muted: (t: string) => wrapAnsi(t, ANSI_DIM),
      border: (t: string) => wrapAnsi(t, ANSI_DIM),
      success: (t: string) => wrapAnsi(t, ANSI_BOLD),
      warning: (t: string) => wrapAnsi(t, ANSI_BOLD),
      error: (t: string) => wrapAnsi(t, ANSI_BOLD),
      info: (t: string) => t,
      active: (t: string) => wrapAnsi(t, `${ANSI_BOLD}${ANSI_UNDERLINE}`),
      bold: (t: string) => wrapAnsi(t, ANSI_BOLD),
      dim: (t: string) => wrapAnsi(t, ANSI_DIM),
      highlight: (t: string) => wrapAnsi(t, ANSI_BOLD),
    };
  }

  if (capabilities.theme === "aurora") {
    return {
      brand: (t: string) => wrapAnsi(t, `${ANSI_BOLD}${AURORA_LAVENDER}`),
      heading: (t: string) => wrapAnsi(t, `${ANSI_BOLD}${AURORA_WHITE}`),
      text: (t: string) => wrapAnsi(t, AURORA_WHITE),
      muted: (t: string) => wrapAnsi(t, AURORA_SLATE),
      border: (t: string) => wrapAnsi(t, AURORA_DARK),
      success: (t: string) => wrapAnsi(t, `${ANSI_BOLD}${AURORA_TEAL}`),
      warning: (t: string) => wrapAnsi(t, `${ANSI_BOLD}${AURORA_PEACH}`),
      error: (t: string) => wrapAnsi(t, `${ANSI_BOLD}${AURORA_ROSE}`),
      info: (t: string) => wrapAnsi(t, AURORA_ICE),
      active: (t: string) => wrapAnsi(t, `${ANSI_BOLD}${AURORA_VIOLET}`),
      bold: (t: string) => wrapAnsi(t, ANSI_BOLD),
      dim: (t: string) => wrapAnsi(t, ANSI_DIM),
      highlight: (t: string) => wrapAnsi(t, `${ANSI_BOLD}${AURORA_LAVENDER}`),
    };
  }

  // Default: Classic theme
  return {
    brand: (t: string) => wrapAnsi(t, `${ANSI_BOLD}${CLASSIC_SKY}`),
    heading: (t: string) => wrapAnsi(t, `${ANSI_BOLD}${CLASSIC_WHITE}`),
    text: (t: string) => wrapAnsi(t, CLASSIC_WHITE),
    muted: (t: string) => wrapAnsi(t, CLASSIC_SLATE),
    border: (t: string) => wrapAnsi(t, CLASSIC_DARK),
    success: (t: string) => wrapAnsi(t, `${ANSI_BOLD}${CLASSIC_EMERALD}`),
    warning: (t: string) => wrapAnsi(t, `${ANSI_BOLD}${CLASSIC_AMBER}`),
    error: (t: string) => wrapAnsi(t, `${ANSI_BOLD}${CLASSIC_RED}`),
    info: (t: string) => wrapAnsi(t, CLASSIC_BLUE),
    active: (t: string) => wrapAnsi(t, `${ANSI_BOLD}${CLASSIC_BLUE}`),
    bold: (t: string) => wrapAnsi(t, ANSI_BOLD),
    dim: (t: string) => wrapAnsi(t, ANSI_DIM),
    highlight: (t: string) => wrapAnsi(t, `${ANSI_BOLD}${CLASSIC_SKY}`),
  };
}
