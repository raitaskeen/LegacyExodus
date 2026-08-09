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
