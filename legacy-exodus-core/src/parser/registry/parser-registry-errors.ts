import { LegacyExodusError, type ErrorMetadata } from "@shared/errors";

export class ParserNotFoundError extends LegacyExodusError {
  public constructor(parserId: string) {
    super({
      code: "PARSER_NOT_FOUND",
      message: `Parser '${parserId}' is not registered.`,
      metadata: { parserId },
    });

    this.name = "ParserNotFoundError";
  }
}

export class UnsupportedLanguageError extends LegacyExodusError {
  public constructor(language: string) {
    super({
      code: "PARSER_LANGUAGE_UNSUPPORTED",
      message: `No parser supports language '${language}'.`,
      metadata: { language },
    });

    this.name = "UnsupportedLanguageError";
  }
}

export class ParserRegistrationError extends LegacyExodusError {
  public constructor(parserId: string, message: string, metadata: ErrorMetadata = {}) {
    super({
      code: "PARSER_REGISTRATION_INVALID",
      message,
      metadata: { parserId, ...metadata },
    });

    this.name = "ParserRegistrationError";
  }
}

export class InvalidParserResultError extends LegacyExodusError {
  public constructor(parserId: string, cause: unknown) {
    super({
      code: "PARSER_RESULT_INVALID",
      message: `Parser '${parserId}' returned an invalid result.`,
      metadata: { parserId },
      cause,
    });

    this.name = "InvalidParserResultError";
  }
}

export class ParserExecutionError extends LegacyExodusError {
  public constructor(parserId: string, cause: unknown) {
    super({
      code: "PARSER_EXECUTION_FAILED",
      message: `Parser '${parserId}' failed during execution.`,
      metadata: { parserId },
      cause,
    });

    this.name = "ParserExecutionError";
  }
}
