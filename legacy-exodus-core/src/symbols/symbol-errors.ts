import { LegacyExodusError } from "@shared/errors";

export class UnsupportedSymbolLanguageError extends LegacyExodusError {
  public constructor(language: string) {
    super({
      code: "SYMBOL_LANGUAGE_UNSUPPORTED",
      message: `Symbol extraction does not support language '${language}'.`,
      metadata: { language },
    });

    this.name = "UnsupportedSymbolLanguageError";
  }
}

export class SymbolExtractionError extends LegacyExodusError {
  public constructor(message: string, code = "SYMBOL_EXTRACTION_FAILED", metadata: Record<string, unknown> = {}) {
    super({
      code,
      message,
      metadata,
    });

    this.name = "SymbolExtractionError";
  }
}
