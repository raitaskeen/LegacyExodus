export type RenderingMode = "interactive" | "ci" | "plain" | "json";

export interface TerminalCapabilities {
  readonly isTTY: boolean;
  readonly isCI: boolean;
  readonly noColor: boolean;
  readonly isUnicodeSupported: boolean;
  readonly width: number;
  readonly mode: RenderingMode;
}

export function detectTerminalCapabilities(options: {
  readonly json?: boolean;
  readonly plain?: boolean;
  readonly stream?: NodeJS.WriteStream;
} = {}): TerminalCapabilities {
  const stream = options.stream ?? process.stdout;
  const isTTY = Boolean(stream.isTTY);
  const isCI = Boolean(process.env.CI && process.env.CI !== "0" && process.env.CI !== "false");
  const noColor = Boolean(
    process.env.NO_COLOR !== undefined ||
    process.argv.includes("--no-color") ||
    process.env.NODE_DISABLE_COLORS === "1"
  );

  const isUnicodeSupported = Boolean(
    process.platform !== "win32" ||
    process.env.WT_SESSION || // Windows Terminal
    process.env.TERM_PROGRAM === "vscode" ||
    process.env.TERM?.includes("xterm") ||
    process.env.LANG?.includes("UTF-8") ||
    process.env.LC_ALL?.includes("UTF-8")
  );

  const width = stream.columns && stream.columns > 0 ? stream.columns : 80;

  let mode: RenderingMode = "interactive";
  if (options.json) {
    mode = "json";
  } else if (options.plain) {
    mode = "plain";
  } else if (!isTTY) {
    mode = "plain";
  } else if (isCI) {
    mode = "ci";
  } else if (noColor) {
    mode = "plain";
  }

  return {
    isTTY,
    isCI,
    noColor,
    isUnicodeSupported,
    width,
    mode,
  };
}
