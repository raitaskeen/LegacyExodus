import { describe, expect, test } from "bun:test";

import {
  ParserNotFoundError,
  ParserRegistrationError,
  ParserRegistry,
  type ParseRequest,
  type ParseResponse,
  type Parser,
} from "@parser/index";

function createParser(id: string, languages: readonly string[] = ["javascript"]): Parser {
  return {
    id,
    name: "Test Parser",
    version: "1.0.0",
    supportedLanguages: languages,
    capabilities: ["ast", "locations"],
    canHandle: (_request: ParseRequest): boolean => true,
    parse: async (_request: ParseRequest): Promise<ParseResponse> => ({
      result: {
        metadata: { parserId: id, language: languages[0] ?? "javascript", sourcePath: "source.js" },
        root: { type: "Program", attributes: {}, children: [] },
        statistics: { durationMs: 0, nodeCount: 1 },
        warnings: [],
        errors: [],
      },
    }),
  };
}

describe("ParserRegistry", () => {
  test("registers parsers and supports lookup by identifier, language, and capability", (): void => {
    const registry = new ParserRegistry();
    const parser = createParser("javascript-parser", ["javascript", "jsx"]);

    registry.register(parser);

    expect(registry.has("javascript-parser")).toBe(true);
    expect(registry.get("javascript-parser")).toBe(parser);
    expect(registry.findByLanguage("JAVASCRIPT")).toBe(parser);
    expect(registry.findByCapability("locations")).toEqual([parser]);
    expect(registry.list()).toEqual([parser]);
    expect(Object.isFrozen(registry.list())).toBe(true);
  });

  test("rejects duplicate identifiers and reports missing parsers", (): void => {
    const registry = new ParserRegistry();
    registry.register(createParser("javascript-parser"));

    expect(() => registry.register(createParser("javascript-parser"))).toThrow(
      ParserRegistrationError,
    );
    expect(() => registry.get("missing-parser")).toThrow(ParserNotFoundError);
    expect(registry.findByLanguage("python")).toBeNull();
  });

  test("unregisters parsers deterministically", (): void => {
    const registry = new ParserRegistry();
    registry.register(createParser("javascript-parser"));

    registry.unregister("javascript-parser");

    expect(registry.list()).toEqual([]);
    expect(() => registry.unregister("javascript-parser")).toThrow(ParserNotFoundError);
  });
});
