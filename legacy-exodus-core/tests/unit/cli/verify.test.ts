import { describe, expect, it } from "bun:test";
import { extractDiagnosticSnippet, runCommand } from "@cli/commands/verify";

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

  describe("parseBunTestOutput", () => {
    it("parses full test suite output with categories and summary", async () => {
      const { parseBunTestOutput } = await import("@cli/presentation/test-runner");
      const raw = [
        "bun test v1.3.14",
        "",
        "tests/unit/discovery/scanner.test.ts:",
        "(pass) scanner > finds files [10.2ms]",
        "(pass) scanner > filters files [5.1ms]",
        "",
        "tests/unit/parser/javascript.test.ts:",
        "(pass) js parser > parses AST [15.0ms]",
        "",
        "-------------------|---------|---------|-------------------",
        "File               | % Funcs | % Lines | Uncovered Line #s",
        "-------------------|---------|---------|-------------------",
        "All files          |   85.50 |   88.20 |",
        "-------------------|---------|---------|-------------------",
        "",
        " 3 pass",
        " 0 fail",
        " 12 expect() calls",
        "Ran 3 tests across 2 files. [450.00ms]",
      ].join("\n");

      const result = parseBunTestOutput(raw);
      expect(result.isFocused).toBe(false);
      expect(result.suitesTotal).toBe(2);
      expect(result.testsPassed).toBe(3);
      expect(result.testsFailed).toBe(0);
      expect(result.assertionsTotal).toBe(12);
      expect(result.durationMs).toBe(450);
      expect(result.coverage?.functionsPct).toBe(85.5);
      expect(result.coverage?.linesPct).toBe(88.2);

      const discoveryCat = result.categories.find((c) => c.name === "Discovery");
      expect(discoveryCat).toBeDefined();
      expect(discoveryCat?.passed).toBe(2);

      const parserCat = result.categories.find((c) => c.name === "Parser");
      expect(parserCat).toBeDefined();
      expect(parserCat?.passed).toBe(1);
    });

    it("parses focused test run output and detects single target", async () => {
      const { parseBunTestOutput } = await import("@cli/presentation/test-runner");
      const raw = [
        "bun test v1.3.14",
        "",
        "tests/unit/storage/sqlite-storage.test.ts:",
        "(pass) sqlite > persists record [20.0ms]",
        "",
        " 1 pass",
        " 0 fail",
        " 4 expect() calls",
        "Ran 1 tests across 1 file. [150.00ms]",
      ].join("\n");

      const result = parseBunTestOutput(raw, "tests/unit/storage/sqlite-storage.test.ts");
      expect(result.isFocused).toBe(true);
      expect(result.target).toBe("tests/unit/storage/sqlite-storage.test.ts");
      expect(result.testsPassed).toBe(1);
      expect(result.testsFailed).toBe(0);
      expect(result.assertionsTotal).toBe(4);
    });

    it("parses failure assertion details", async () => {
      const { parseBunTestOutput } = await import("@cli/presentation/test-runner");
      const raw = [
        "tests/unit/semantic/semantic-engine.test.ts:",
        "(fail) semantic > resolves bindings [2.0ms]",
        "Expected: 3 calls",
        "Received: 2 calls",
        "at tests/unit/semantic/semantic-engine.test.ts:184:10",
        "",
        " 0 pass",
        " 1 fail",
        " 5 expect() calls",
        "Ran 1 tests across 1 file. [100.00ms]",
      ].join("\n");

      const result = parseBunTestOutput(raw);
      expect(result.testsFailed).toBe(1);
      expect(result.failures.length).toBe(1);
      expect(result.failures[0]?.test).toBe("semantic > resolves bindings");
      expect(result.failures[0]?.expected).toBe("3 calls");
      expect(result.failures[0]?.received).toBe("2 calls");
      expect(result.failures[0]?.location).toContain("semantic-engine.test.ts:184:10");
    });
  });

  describe("runCommand Subprocess Security & Argument Isolation", () => {
    it("preserves literal arguments containing shell metacharacters without shell execution", async () => {
      const payloads = [
        "hello & echo injected-shell-command",
        "foo && whoami",
        "foo | whoami",
        "foo || whoami",
        "foo; whoami",
        "foo < input.txt",
        "foo > output.txt",
        "foo >> output.txt",
        "foo $(whoami)",
        "foo `whoami`",
        "foo %PATH%",
        "foo (parentheses)",
        "foo \"double\" 'single' quotes",
        "line1\nline2\r\nline3",
        "C:\\Program Files\\Repo & Co; (v1)\\project",
      ];

      for (const payload of payloads) {
        const result = await runCommand("bun", [
          "-e",
          "console.log(process.argv[process.argv.length - 1])",
          payload,
        ]);

        expect(result.code).toBe(0);
        expect(result.stdout.replace(/\r?\n$/, "")).toBe(payload);
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
      }
    });

    it("executes standard commands cleanly with exit code 0", async () => {
      const result = await runCommand("bun", ["--version"]);
      expect(result.code).toBe(0);
      expect(result.stdout.length).toBeGreaterThan(0);
    });

    it("captures non-zero exit codes from failing commands", async () => {
      const result = await runCommand("bun", ["-e", "process.exit(42)"]);
      expect(result.code).toBe(42);
    });

    it("rejects command names containing null bytes with structured error", async () => {
      const result = await runCommand("bun\0evil", ["--version"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("null bytes");
    });

    it("rejects arguments containing null bytes with structured error", async () => {
      const result = await runCommand("bun", ["-e", "console.log(1)", "hello\0world"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("null bytes");
    });

    it("rejects empty or whitespace-only command names", async () => {
      const result = await runCommand("   ", ["--version"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("non-empty string");
    });

    it("prohibits execution of Windows batch files (.bat and .cmd) for subprocess isolation", async () => {
      const batResult = await runCommand("script.bat", ["arg1"]);
      expect(batResult.code).toBe(1);
      expect(batResult.stderr).toContain("prohibited");

      const cmdResult = await runCommand("tool.cmd", ["arg1"]);
      expect(cmdResult.code).toBe(1);
      expect(cmdResult.stderr).toContain("prohibited");
    });

    it("terminates hanging processes when timeoutMs is specified", async () => {
      const result = await runCommand(
        "bun",
        ["-e", "await new Promise(() => {})"],
        { timeoutMs: 150 },
      );
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("timed out after 150ms");
    });
  });
});
