import { ConfigurationError, LegacyExodusError } from "@shared/errors";
import { CliError } from "../errors";
import type { TerminalCapabilities } from "./capabilities";
import { createSymbols, type Symbols } from "./symbols";
import { createTheme, type Theme } from "./theme";

export interface FormattedErrorDetails {
  readonly code: string;
  readonly message: string;
  readonly context?: string;
  readonly path?: string;
  readonly runId?: string;
  readonly cause?: string;
  readonly remediation?: string;
}

export function extractErrorDetails(error: unknown): FormattedErrorDetails {
  if (error instanceof CliError) {
    let remediation: string | undefined;
    if (error.code === "WORKSPACE_INVALID") {
      remediation = "Provide an existing directory path: legacy-exodus init ./my-project";
    } else if (error.code === "WORKSPACE_ALREADY_INITIALIZED") {
      remediation = "To reinitialize, remove the existing .legacy-exodus directory first.";
    } else if (error.code === "WORKSPACE_NOT_FOUND") {
      remediation = "Check that the directory exists: ls <path>";
    }

    return {
      code: error.code,
      message: error.message,
      context: "Workspace CLI Command",
      remediation,
    };
  }

  if (error instanceof ConfigurationError) {
    return {
      code: "CONFIG_INVALID",
      message: error.message || "Invalid LegacyExodus configuration.",
      context: "Runtime Configuration",
      remediation: "Verify environment variables and configuration files.",
    };
  }

  if (error instanceof LegacyExodusError) {
    const meta = error.metadata as Record<string, unknown> | undefined;
    let remediation: string | undefined;

    if (error.code === "DISCOVERY_PATH_NOT_FOUND") {
      remediation = "Verify the target project path exists and has read permissions.";
    } else if (error.code === "ANALYSIS_RUN_FAILED") {
      remediation = "Inspect the underlying error details or run with debug options.";
    } else if (error.code === "STORAGE_SCHEMA_VERSION_MISMATCH") {
      remediation = "Ensure the database schema version matches the active engine version.";
    }

    return {
      code: error.code,
      message: error.message || "LegacyExodus operation failed.",
      context: meta?.context ? String(meta.context) : "Engine Execution",
      path: meta?.path ? String(meta.path) : meta?.projectPath ? String(meta.projectPath) : undefined,
      runId: meta?.analysisRunId ? String(meta.analysisRunId) : meta?.runId ? String(meta.runId) : undefined,
      cause: meta?.error ? String(meta.error) : undefined,
      remediation,
    };
  }

  if (error instanceof Error) {
    return {
      code: "CLI_UNEXPECTED_ERROR",
      message: error.message,
      context: "Unexpected Runtime Exception",
      cause: error.stack ? error.stack.split("\n")[0] : undefined,
      remediation: "Report this issue with the command and execution environment.",
    };
  }

  return {
    code: "CLI_UNEXPECTED_ERROR",
    message: String(error) || "An unknown error occurred.",
    context: "Unknown Failure",
  };
}

export class ErrorPresenter {
  public readonly theme: Theme;
  public readonly symbols: Symbols;

  public constructor(public readonly capabilities: TerminalCapabilities) {
    this.theme = createTheme(capabilities);
    this.symbols = createSymbols(capabilities);
  }

  public renderError(error: unknown): string {
    const details = extractErrorDetails(error);

    if (this.capabilities.mode === "plain" || this.capabilities.mode === "ci") {
      const parts = [
        `Error: ${details.message}`,
        `Code: ${details.code}`,
      ];
      if (details.path) parts.push(`Path: ${details.path}`);
      if (details.runId) parts.push(`Run ID: ${details.runId}`);
      if (details.cause) parts.push(`Cause: ${details.cause}`);
      if (details.remediation) parts.push(`Remediation: ${details.remediation}`);
      return parts.join("\n");
    }

    const dividerWidth = Math.min(Math.max(this.capabilities.width - 4, 40), 80);
    const header = `  ${this.theme.brand(this.symbols.brand)} ${this.theme.heading("LegacyExodus")} ${this.theme.muted(this.symbols.arrow)} ${this.theme.error("Error")}`;
    const divider = `  ${this.theme.border(this.symbols.horizontalRule.repeat(dividerWidth))}`;
    const lines: string[] = [header, divider, ""];

    lines.push(`    ${this.theme.muted("Code".padEnd(14, " "))}${this.theme.heading(details.code)}`);
    lines.push(`    ${this.theme.muted("Message".padEnd(14, " "))}${this.theme.text(details.message)}`);

    if (details.context) {
      lines.push(`    ${this.theme.muted("Context".padEnd(14, " "))}${this.theme.text(details.context)}`);
    }
    if (details.path) {
      lines.push(`    ${this.theme.muted("Target Path".padEnd(14, " "))}${this.theme.text(details.path)}`);
    }
    if (details.runId) {
      lines.push(`    ${this.theme.muted("Run ID".padEnd(14, " "))}${this.theme.text(details.runId)}`);
    }
    if (details.cause) {
      lines.push(`    ${this.theme.muted("Cause".padEnd(14, " "))}${this.theme.warning(details.cause)}`);
    }
    if (details.remediation) {
      lines.push("");
      lines.push(`    ${this.theme.muted("Hint")}`);
      lines.push(`    ${this.theme.info(details.remediation)}`);
    }

    lines.push("");
    lines.push(divider);
    lines.push(`  ${this.theme.error(this.symbols.failure)} ${this.theme.error("Operation failed")}`);

    return lines.join("\n");
  }

  public renderWarning(message: string, code?: string): string {
    const prefix = `${this.theme.warning(this.symbols.warning)} ${this.theme.warning("Warning")}`;
    const codePart = code ? ` [${this.theme.muted(code)}]` : "";
    return `  ${prefix}${codePart}: ${this.theme.text(message)}`;
  }
}
