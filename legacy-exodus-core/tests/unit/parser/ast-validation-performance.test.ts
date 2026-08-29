import { describe, expect, it } from "bun:test";

import {
  freezeNode,
  validateASTNode,
  validateASTResult,
  validateParseResponse,
  ParserManager,
  ParserRegistry,
  JavaScriptParser,
  type ParseRequest,
} from "@parser/index";
import { LegacyExodusError } from "@shared/errors";
import { JavaScriptSymbolExtractor } from "@symbols/index";

describe("F-03: AST Validation Fast-Path, Deep-Freeze Idempotency & Schema Integrity", () => {
  describe("A. Validation & Deep Freeze Idempotency", () => {
    it("validates and deeply freezes an unvalidated AST node", () => {
      const rawNode = {
        type: "Identifier",
        role: "name",
        attributes: { name: "foo" },
        children: [],
      };

      const frozenNode = validateASTNode(rawNode);
      expect(Object.isFrozen(frozenNode)).toBe(true);
      expect(Object.isFrozen(frozenNode.attributes)).toBe(true);
      expect(Object.isFrozen(frozenNode.children)).toBe(true);
      expect(frozenNode.type).toBe("Identifier");

      // Fast-path: subsequent call returns identical instance without re-cloning
      const fastPathNode = validateASTNode(frozenNode);
      expect(fastPathNode).toBe(frozenNode);

      const directFreeze = freezeNode(frozenNode);
      expect(directFreeze).toBe(frozenNode);
    });

    it("validates and deeply freezes an unvalidated ASTResult", () => {
      const rawResult = {
        metadata: {
          parserId: "test-parser",
          language: "javascript",
          sourcePath: "src/sample.js",
        },
        root: {
          type: "Program",
          attributes: {},
          children: [
            {
              type: "Literal",
              attributes: { value: 42 },
              children: [],
            },
          ],
        },
        statistics: { durationMs: 5, nodeCount: 2 },
        warnings: [{ code: "TEST_WARN", message: "A warning" }],
        errors: [],
      };

      const frozenResult = validateASTResult(rawResult);
      expect(Object.isFrozen(frozenResult)).toBe(true);
      expect(Object.isFrozen(frozenResult.metadata)).toBe(true);
      expect(Object.isFrozen(frozenResult.root)).toBe(true);
      expect(Object.isFrozen(frozenResult.statistics)).toBe(true);
      expect(Object.isFrozen(frozenResult.warnings)).toBe(true);
      expect(Object.isFrozen(frozenResult.errors)).toBe(true);

      // Fast-path: subsequent call returns identical instance without re-cloning or re-validating
      const fastPathResult = validateASTResult(frozenResult);
      expect(fastPathResult).toBe(frozenResult);
      expect(fastPathResult.root).toBe(frozenResult.root);
    });

    it("validates and deeply freezes ParseResponse idempotently", () => {
      const rawResult = {
        metadata: {
          parserId: "test-parser",
          language: "javascript",
          sourcePath: "src/sample.js",
        },
        root: {
          type: "Program",
          attributes: {},
          children: [],
        },
        statistics: { durationMs: 1, nodeCount: 1 },
        warnings: [],
        errors: [],
      };

      const rawResponse = { result: rawResult };
      const frozenResponse = validateParseResponse(rawResponse);

      expect(Object.isFrozen(frozenResponse)).toBe(true);
      expect(Object.isFrozen(frozenResponse.result)).toBe(true);

      // Fast-path: subsequent call returns identical instance
      const fastPathResponse = validateParseResponse(frozenResponse);
      expect(fastPathResponse).toBe(frozenResponse);
      expect(fastPathResponse.result).toBe(frozenResponse.result);
    });
  });

  describe("B. Pipeline Integration & Zero Duplicate Cloning", () => {
    it("ParserManager.parse produces a frozen ASTResult that passes symbol extraction in O(1) without re-cloning", async () => {
      const registry = new ParserRegistry();
      registry.register(new JavaScriptParser());
      const manager = new ParserManager(registry);
      const extractor = new JavaScriptSymbolExtractor();

      const request: ParseRequest = {
        file: {
          id: "f-opt-1",
          path: "src/service.js",
          language: "javascript",
          size: 50,
        },
        source: "export function run() { return 100; }",
      };

      const ast = await manager.parse(request);
      expect(Object.isFrozen(ast)).toBe(true);
      expect(Object.isFrozen(ast.root)).toBe(true);

      // validateASTResult returns the identical reference
      const reValidated = validateASTResult(ast);
      expect(reValidated).toBe(ast);

      // Extract symbols without error
      const table = extractor.extract(ast);
      expect(table.symbols.length).toBeGreaterThan(0);
      expect(table.filePath).toBe("src/service.js");
    });
  });

  describe("C. Error Rejection & Security Boundary", () => {
    it("rejects invalid AST nodes missing required fields", () => {
      expect(() => validateASTNode({ type: "" })).toThrow(LegacyExodusError);
      expect(() => validateASTNode(null)).toThrow(LegacyExodusError);
      expect(() => validateASTNode({ type: "Program" })).toThrow(LegacyExodusError);
    });

    it("rejects invalid AST results missing required metadata or root", () => {
      expect(() => validateASTResult({})).toThrow(LegacyExodusError);
      expect(() =>
        validateASTResult({
          metadata: { parserId: "", language: "javascript", sourcePath: "a.js" },
          root: { type: "Program", attributes: {}, children: [] },
          statistics: { durationMs: 0, nodeCount: 1 },
          warnings: [],
          errors: [],
        }),
      ).toThrow(LegacyExodusError);
    });

    it("rejects invalid ParseResponse objects", () => {
      expect(() => validateParseResponse(null)).toThrow(LegacyExodusError);
      expect(() => validateParseResponse({})).toThrow(LegacyExodusError);
      expect(() => validateParseResponse({ result: "not-an-ast" })).toThrow(LegacyExodusError);
    });
  });
});
