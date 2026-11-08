import type { Parser } from "@parser/contracts/parser";
import type { ParserCapability } from "@parser/contracts/parser-capability";
import { validateParserMetadata } from "@parser/contracts/parser-metadata";

import {
  ParserNotFoundError,
  ParserRegistrationError,
} from "./parser-registry-errors";
import { immutable } from "@shared/immutability";

export class ParserRegistry {
  private readonly parsers = new Map<string, Parser>();

  public register(parser: Parser): void {
    const metadata = validateParserMetadata(parser);

    if (this.parsers.has(metadata.id)) {
      throw new ParserRegistrationError(metadata.id, `Parser '${metadata.id}' is already registered.`);
    }

    this.parsers.set(metadata.id, parser);
  }

  public unregister(id: string): void {
    if (!this.parsers.delete(id)) {
      throw new ParserNotFoundError(id);
    }
  }

  public get(id: string): Parser {
    const parser = this.parsers.get(id);

    if (parser === undefined) {
      throw new ParserNotFoundError(id);
    }

    return parser;
  }

  public has(id: string): boolean {
    return this.parsers.has(id);
  }

  public list(): readonly Parser[] {
    return immutable([...this.parsers.values()]);
  }

  public findByLanguage(language: string): Parser | null {
    const normalizedLanguage = language.toLowerCase();

    return (
      [...this.parsers.values()].find((parser) =>
        parser.supportedLanguages.some(
          (supportedLanguage) => supportedLanguage.toLowerCase() === normalizedLanguage,
        ),
      ) ?? null
    );
  }

  public findByCapability(capability: ParserCapability): readonly Parser[] {
    return immutable(
      [...this.parsers.values()].filter((parser) => parser.capabilities.includes(capability)),
    );
  }
}
