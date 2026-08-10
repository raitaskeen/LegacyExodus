import { describe, expect, test } from "bun:test";

import { ConfigurationError, LegacyExodusError } from "@shared/errors";
import {
  InvalidParserResultError,
  ParserExecutionError,
  ParserNotFoundError,
  ParserRegistrationError,
  UnsupportedLanguageError,
} from "@parser/index";
import { ParserRegistry, type ParseRequest, type ParseResponse, type Parser } from "@parser/index";
import { JavaScriptSymbolExtractor, UnsupportedSymbolLanguageError } from "@symbols/index";

function createParser(id: string): Parser {
  return {
    id,
    name: "Test Parser",
    version: "1.0.0",
    supportedLanguages: ["javascript"],
    capabilities: ["ast"],
    canHandle: (_request: ParseRequest): boolean => true,
    parse: async (_request: ParseRequest): Promise<ParseResponse> => {
      throw new Error("not used");
    },
  };
}

describe("error boundaries", () => {
  test("reports deterministic shared and parser errors", (): void => {
    const shared = new LegacyExodusError({ code: "TEST", message: "Test failure", metadata: { source: "test" } });
    const config = new ConfigurationError("Configuration is invalid.");

    expect(shared.code).toBe("TEST");
    expect(shared.message).toBe("Test failure");
    expect(config.code).toBe("RUNTIME_CONFIGURATION_INVALID");
    expect(new ParserNotFoundError("missing").message).toBe("Parser 'missing' is not registered.");
    expect(new UnsupportedLanguageError("php").message).toBe("No parser supports language 'php'.");
    expect(new ParserRegistrationError("bad", "Bad parser.").message).toBe("Bad parser.");
    expect(new InvalidParserResultError("js", new Error()).code).toBe("PARSER_RESULT_INVALID");
    expect(new ParserExecutionError("js", new Error()).code).toBe("PARSER_EXECUTION_FAILED");
    expect(new UnsupportedSymbolLanguageError("python").message).toBe(
      "Symbol extraction does not support language 'python'.",
    );
  });

  test("rejects malformed parser capabilities and duplicate parser identifiers", (): void => {
    const registry = new ParserRegistry();

    expect(() =>
      registry.register({
        ...createParser("invalid-parser"),
        capabilities: ["unsupported" as never],
      }),
    ).toThrow(ParserRegistrationError);

    registry.register(createParser("duplicate-parser"));
    expect(() => registry.register(createParser("duplicate-parser"))).toThrow(ParserRegistrationError);
  });

  test("rejects corrupted AST input at the symbol extraction boundary", (): void => {
    expect(() =>
      new JavaScriptSymbolExtractor().extract({
        metadata: { parserId: "javascript-parser", language: "javascript", sourcePath: "broken.js" },
        root: { type: "Program", attributes: {}, children: "not-an-array" },
        statistics: { durationMs: 0, nodeCount: 1 },
        warnings: [],
        errors: [],
      } as unknown as never),
    ).toThrow(LegacyExodusError);
  });
});
