import { describe, expect, test } from "bun:test";

import {
  ParserRegistrationError,
  validateASTResult,
  validateParserMetadata,
} from "@parser/index";

describe("parser contracts", () => {
  test("validates and deeply freezes immutable AST result contracts", (): void => {
    const result = validateASTResult({
      metadata: {
        parserId: "javascript-parser",
        language: "javascript",
        sourcePath: "src/catalog.js",
      },
      root: {
        type: "Program",
        attributes: {},
        children: [
          {
            type: "VariableDeclaration",
            attributes: { declarationKind: "const" },
            children: [],
          },
        ],
      },
      statistics: { durationMs: 2, nodeCount: 2 },
      warnings: [{ code: "COMMENT_IGNORED", message: "Comments are not enabled." }],
      errors: [],
    });

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.root.children)).toBe(true);
    expect(Object.isFrozen(result.root.children[0] ?? {})).toBe(true);
    expect(Object.isFrozen(result.warnings[0] ?? {})).toBe(true);
  });

  test("rejects invalid metadata and duplicate capabilities", (): void => {
    expect(() =>
      validateParserMetadata({
        id: "Invalid Parser",
        name: "Invalid Parser",
        version: "1.0.0",
        supportedLanguages: ["javascript"],
        capabilities: ["ast"],
      }),
    ).toThrow(ParserRegistrationError);

    expect(() =>
      validateParserMetadata({
        id: "javascript-parser",
        name: "JavaScript Parser",
        version: "1.0.0",
        supportedLanguages: ["javascript"],
        capabilities: ["ast", "ast"],
      }),
    ).toThrow(ParserRegistrationError);
  });
});
