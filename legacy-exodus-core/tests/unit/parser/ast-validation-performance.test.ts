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

describe("F-03 / CodeRabbit Remediation: AST Validation Provenance & Trust Boundary", () => {
  describe("A. Validation & Deep Freeze Idempotency Fast-Path", () => {
    it("validates and deeply freezes an unvalidated AST node, then reuses identity on subsequent validation", () => {
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

    it("validates and deeply freezes an unvalidated ASTResult, then reuses identity on subsequent validation", () => {
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

  describe("B. Security & Trust Boundary: Frozen ≠ Validated", () => {
    it("rejects a manually frozen malformed ASTNode without trusting Object.isFrozen()", () => {
      const frozenMalformedNode = Object.freeze({
        type: "", // invalid: empty type
        attributes: Object.freeze({}),
        children: Object.freeze([]),
      });

      expect(Object.isFrozen(frozenMalformedNode)).toBe(true);
      expect(() => validateASTNode(frozenMalformedNode)).toThrow(LegacyExodusError);
      try {
        validateASTNode(frozenMalformedNode);
      } catch (error) {
        expect(error).toBeInstanceOf(LegacyExodusError);
        expect((error as LegacyExodusError).code).toBe("AST_NODE_INVALID");
      }
    });

    it("rejects a manually frozen malformed ASTResult without trusting Object.isFrozen()", () => {
      const frozenMalformedResult = Object.freeze({
        metadata: Object.freeze({
          parserId: "", // invalid: empty parserId
          language: "javascript",
          sourcePath: "src/bad.js",
        }),
        root: Object.freeze({
          type: "Program",
          attributes: Object.freeze({}),
          children: Object.freeze([]),
        }),
        statistics: Object.freeze({ durationMs: -1, nodeCount: -1 }), // invalid: negative
        warnings: Object.freeze([]),
        errors: Object.freeze([]),
      });

      expect(Object.isFrozen(frozenMalformedResult)).toBe(true);
      expect(() => validateASTResult(frozenMalformedResult)).toThrow(LegacyExodusError);
      try {
        validateASTResult(frozenMalformedResult);
      } catch (error) {
        expect(error).toBeInstanceOf(LegacyExodusError);
        expect((error as LegacyExodusError).code).toBe("AST_RESULT_INVALID");
      }
    });

    it("rejects a manually frozen malformed ParseResponse without trusting Object.isFrozen()", () => {
      const frozenMalformedResponse = Object.freeze({
        result: Object.freeze({
          invalidPayload: true,
        }),
      });

      expect(Object.isFrozen(frozenMalformedResponse)).toBe(true);
      expect(() => validateParseResponse(frozenMalformedResponse)).toThrow(LegacyExodusError);
    });

    it("processes an unknown manually frozen valid ASTResult through full validation rather than blind trust", () => {
      // Create a valid result that is frozen manually, NOT through validateASTResult
      const unknownFrozenResult = Object.freeze({
        metadata: Object.freeze({
          parserId: "manual-parser",
          language: "javascript",
          sourcePath: "src/manual.js",
        }),
        root: Object.freeze({
          type: "Program",
          attributes: Object.freeze({ strict: true }),
          children: Object.freeze([]),
        }),
        statistics: Object.freeze({ durationMs: 1, nodeCount: 1 }),
        warnings: Object.freeze([]),
        errors: Object.freeze([]),
      });

      expect(Object.isFrozen(unknownFrozenResult)).toBe(true);

      // validateASTResult must process and return a validated instance
      const validated = validateASTResult(unknownFrozenResult);
      expect(validated.metadata.sourcePath).toBe("src/manual.js");

      // The returned instance is now in the module-private WeakSet and uses the fast-path
      expect(validateASTResult(validated)).toBe(validated);
    });
  });

  describe("C. Pipeline Integration & Zero Duplicate Cloning", () => {
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

  describe("D. Raw / Unfrozen Schema Error Rejection", () => {
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

  describe("E. Location Deep-Freeze Integrity & Identity Reuse", () => {
    it("reuses fully frozen location by reference", () => {
      const start = Object.freeze({ line: 1, column: 0 });
      const end = Object.freeze({ line: 1, column: 10 });
      const location = Object.freeze({ start, end });

      const rawNode = {
        type: "Identifier",
        location,
        attributes: Object.freeze({ name: "test" }),
        children: Object.freeze([]),
      };

      const frozen = freezeNode(rawNode);
      expect(frozen.location).toBe(location);
      expect(frozen.location?.start).toBe(start);
      expect(frozen.location?.end).toBe(end);
    });

    it("deeply freezes location with mutable start and preserves already-frozen end identity", () => {
      const start = { line: 2, column: 4 }; // mutable
      const end = Object.freeze({ line: 2, column: 15 }); // frozen
      const location = Object.freeze({ start, end }); // frozen outer

      const rawNode = {
        type: "Identifier",
        location,
        attributes: Object.freeze({ name: "test" }),
        children: Object.freeze([]),
      };

      const frozen = freezeNode(rawNode);
      expect(Object.isFrozen(frozen.location)).toBe(true);
      expect(Object.isFrozen(frozen.location?.start)).toBe(true);
      expect(frozen.location?.start).toEqual({ line: 2, column: 4 });
      expect(frozen.location?.end).toBe(end); // preserved identity
    });

    it("deeply freezes location with mutable end and preserves already-frozen start identity", () => {
      const start = Object.freeze({ line: 3, column: 0 }); // frozen
      const end = { line: 3, column: 8 }; // mutable
      const location = Object.freeze({ start, end }); // frozen outer

      const rawNode = {
        type: "Identifier",
        location,
        attributes: Object.freeze({ name: "test" }),
        children: Object.freeze([]),
      };

      const frozen = freezeNode(rawNode);
      expect(Object.isFrozen(frozen.location)).toBe(true);
      expect(Object.isFrozen(frozen.location?.end)).toBe(true);
      expect(frozen.location?.end).toEqual({ line: 3, column: 8 });
      expect(frozen.location?.start).toBe(start); // preserved identity
    });

    it("deeply freezes location when both start and end are mutable inside frozen outer", () => {
      const start = { line: 5, column: 1 }; // mutable
      const end = { line: 5, column: 20 }; // mutable
      const location = Object.freeze({ start, end }); // frozen outer

      const rawNode = {
        type: "Identifier",
        location,
        attributes: Object.freeze({ name: "test" }),
        children: Object.freeze([]),
      };

      const frozen = freezeNode(rawNode);
      expect(Object.isFrozen(frozen.location)).toBe(true);
      expect(Object.isFrozen(frozen.location?.start)).toBe(true);
      expect(Object.isFrozen(frozen.location?.end)).toBe(true);
      expect(frozen.location?.start).toEqual({ line: 5, column: 1 });
      expect(frozen.location?.end).toEqual({ line: 5, column: 20 });
    });

    it("ensures node with partially mutable location is fully deep-frozen upon validateASTNode", () => {
      const rawNode = {
        type: "Identifier",
        location: Object.freeze({
          start: { line: 10, column: 2 }, // mutable
          end: { line: 10, column: 12 },   // mutable
        }),
        attributes: { name: "x" },
        children: [],
      };

      const validated = validateASTNode(rawNode);
      expect(Object.isFrozen(validated)).toBe(true);
      expect(Object.isFrozen(validated.location)).toBe(true);
      expect(Object.isFrozen(validated.location?.start)).toBe(true);
      expect(Object.isFrozen(validated.location?.end)).toBe(true);

      // Identity reuse on subsequent call
      expect(validateASTNode(validated)).toBe(validated);
    });
  });
});
