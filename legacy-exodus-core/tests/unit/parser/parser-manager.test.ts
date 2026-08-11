import { describe, expect, test } from "bun:test";

import {
  InvalidParserResultError,
  ParserExecutionError,
  ParserManager,
  ParserRegistry,
  UnsupportedLanguageError,
  type ParseRequest,
  type ParseResponse,
  type Parser,
} from "@parser/index";

const request: ParseRequest = {
  file: {
    id: "file-1",
    path: "src/catalog.js",
    language: "javascript",
    size: 20,
  },
  source: "export const catalog = [];",
};

function createParser(parse: (input: ParseRequest) => Promise<ParseResponse>): Parser {
  return {
    id: "javascript-parser",
    name: "JavaScript Parser Test Double",
    version: "1.0.0",
    supportedLanguages: ["javascript"],
    capabilities: ["ast", "locations"],
    canHandle: (input: ParseRequest): boolean => input.file.language === "javascript",
    parse,
  };
}

describe("ParserManager", () => {
  test("selects the language parser, invokes it, and returns an immutable AST result", async (): Promise<void> => {
    let receivedRequest: ParseRequest | undefined;
    const registry = new ParserRegistry();
    registry.register(
      createParser(async (input): Promise<ParseResponse> => {
        receivedRequest = input;
        return {
          result: {
            metadata: {
              parserId: "javascript-parser",
              language: "javascript",
              sourcePath: input.file.path,
            },
            root: { type: "Program", attributes: { strict: true }, children: [] },
            statistics: { durationMs: 1, nodeCount: 1 },
            warnings: [],
            errors: [],
          },
        };
      }),
    );

    const result = await new ParserManager(registry).parse(request);

    expect(receivedRequest?.file.path).toBe("src/catalog.js");
    expect(result.root.type).toBe("Program");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.root)).toBe(true);
  });

  test("rejects requests for unsupported languages", async (): Promise<void> => {
    await expect(new ParserManager(new ParserRegistry()).parse(request)).rejects.toBeInstanceOf(
      UnsupportedLanguageError,
    );
  });

  test("wraps invalid parser output and parser failures in deterministic errors", async (): Promise<void> => {
    const invalidRegistry = new ParserRegistry();
    invalidRegistry.register(
      createParser(async (): Promise<ParseResponse> => ({ result: { invalid: true } } as unknown as ParseResponse)),
    );

    await expect(new ParserManager(invalidRegistry).parse(request)).rejects.toBeInstanceOf(
      InvalidParserResultError,
    );

    const failingRegistry = new ParserRegistry();
    failingRegistry.register(
      createParser(async (): Promise<ParseResponse> => {
        throw new Error("parser failure");
      }),
    );

    await expect(new ParserManager(failingRegistry).parse(request)).rejects.toBeInstanceOf(
      ParserExecutionError,
    );
  });
});
