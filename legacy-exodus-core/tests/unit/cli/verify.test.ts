import { describe, expect, it } from "bun:test";
import { extractDiagnosticSnippet } from "@cli/commands/verify";

describe("CLI Verify Command & Diagnostic Extraction", () => {
  describe("extractDiagnosticSnippet", () => {
    it("returns complete text when lines are under max limit", () => {
      const input = "Line 1\nLine 2\nLine 3";
      expect(extractDiagnosticSnippet(input, 5)).toBe(input);
    });

    it("locates and extracts TypeScript compiler error location", () => {
      const input = [
        "Starting build...",
        "Resolving modules...",
        "src/cli/app.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.",
        "  12 const x: number = 'test';",
        "     ~",
        "Done with 1 error.",
      ].join("\n");

      const snippet = extractDiagnosticSnippet(input, 3);
      expect(snippet).toContain("error TS2322");
      expect(snippet).toContain("src/cli/app.ts");
    });

    it("locates and extracts test failure assertion blocks", () => {
      const input = [
        "(pass) suite 1 > test 1",
        "(pass) suite 1 > test 2",
        "(fail) suite 2 > failing test",
        "  Expected: 42",
        "  Received: 0",
        "  at tests/unit/foo.test.ts:45:10",
        "Summary: 2 passed, 1 failed",
      ].join("\n");

      const snippet = extractDiagnosticSnippet(input, 4);
      expect(snippet).toContain("(fail)");
      expect(snippet).toContain("Expected: 42");
    });

    it("falls back to bounded tail when no specific error marker is found", () => {
      const lines = Array.from({ length: 30 }, (_, i) => `Log entry #${i + 1}`);
      const input = lines.join("\n");
      const snippet = extractDiagnosticSnippet(input, 5);

      expect(snippet).toContain("Log entry #30");
      expect(snippet).toContain("Log entry #26");
      expect(snippet).not.toContain("Log entry #1");
    });
  });
});
