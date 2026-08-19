import { ConfigurationError, LegacyExodusError } from "@shared/errors";

export class CliError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);

    this.name = "CliError";
  }
}

export class UnexpectedEngineResultError extends LegacyExodusError {
  public constructor(expectedType: string, actualType: string) {
    super({ code: "CLI_ENGINE_RESULT_INVALID", message: "Engine returned an unexpected command result.", metadata: { expectedType, actualType } });
    this.name = "UnexpectedEngineResultError";
  }
}

export interface CliErrorResponse {
  readonly code: string;
  readonly message: string;
}

export function toCliErrorResponse(error: unknown): CliErrorResponse {
  if (error instanceof CliError) {
    return { code: error.code, message: error.message };
  }

  if (error instanceof ConfigurationError) {
    return {
      code: "CONFIG_INVALID",
      message: "Invalid LegacyExodus configuration.",
    };
  }

  if (error instanceof LegacyExodusError) {
    return {
      code: error.code,
      message: "LegacyExodus could not complete the requested operation.",
    };
  }

  return {
    code: "CLI_UNEXPECTED_ERROR",
    message: "LegacyExodus encountered an unexpected error.",
  };
}

export function writeCliError(error: unknown): void {
  const response = toCliErrorResponse(error);

  process.stderr.write(`Error: ${response.message}\nCode: ${response.code}\n`);
}
