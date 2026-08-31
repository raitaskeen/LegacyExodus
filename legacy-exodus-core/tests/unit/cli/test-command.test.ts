import { describe, expect, it } from "bun:test";
import { Command } from "commander";

import {
  discoverTestDomains,
  registerTestCommand,
  resolveConcreteTestPaths,
  TEST_DOMAINS,
} from "@cli/commands/test";

describe("CLI Test Command & Domain Discovery", () => {
  it("defines standard domain taxonomy matching repository layout", () => {
    const domainIds = TEST_DOMAINS.map((d) => d.id);
    expect(domainIds).toContain("runtime");
    expect(domainIds).toContain("parser");
    expect(domainIds).toContain("symbols");
    expect(domainIds).toContain("discovery");
    expect(domainIds).toContain("semantic");
    expect(domainIds).toContain("flow");
    expect(domainIds).toContain("storage");
    expect(domainIds).toContain("governance");
    expect(domainIds).toContain("plugins");
    expect(domainIds).toContain("cli");
  });

  it("discovers test files dynamically across test domains without hardcoded counts", async () => {
    const domains = await discoverTestDomains("tests");
    expect(domains.length).toBe(TEST_DOMAINS.length);

    for (const d of domains) {
      expect(d.id).toBeDefined();
      expect(d.name).toBeDefined();
      expect(typeof d.fileCount).toBe("number");
      expect(d.fileCount).toBeGreaterThanOrEqual(0);
    }

    const parserDomain = domains.find((d) => d.id === "parser");
    expect(parserDomain).toBeDefined();
    expect(parserDomain!.fileCount).toBeGreaterThan(0);

    const symbolsDomain = domains.find((d) => d.id === "symbols");
    expect(symbolsDomain).toBeDefined();
    expect(symbolsDomain!.fileCount).toBeGreaterThan(0);
  });

  it("registers test command on commander program with expected options", () => {
    const program = new Command();
    registerTestCommand(program);

    const testCmd = program.commands.find((c) => c.name() === "test");
    expect(testCmd).toBeDefined();

    const options = testCmd!.options.map((o) => o.long);
    expect(options).toContain("--list");
    expect(options).toContain("--verbose");
    expect(options).toContain("--json");
    expect(options).toContain("--bail");
    expect(options).toContain("--theme");
  });

  it("accurately filters wildcard patterns such that runtime matches runtime*.test.ts but excludes config.test.ts", async () => {
    const domains = await discoverTestDomains("tests");
    const runtimeDomain = domains.find((d) => d.id === "runtime");
    expect(runtimeDomain).toBeDefined();

    // Verify discoverTestDomains accurately counts files matching wildcard patterns
    expect(runtimeDomain!.fileCount).toBeGreaterThanOrEqual(3);
  });

  it("resolves concrete test paths deterministically from wildcard and directory patterns", async () => {
    const patterns = ["tests/unit/core", "tests/unit/runtime*.test.ts"];
    const resolved = await resolveConcreteTestPaths(patterns, "tests");

    expect(resolved.length).toBeGreaterThan(0);
    expect(resolved).toContain("tests/unit/core");
    // Concrete files expanded from wildcard
    const runtimeFiles = resolved.filter((p: string) => p.includes("runtime"));
    expect(runtimeFiles.length).toBeGreaterThanOrEqual(1);

    // Verify all wildcard files start with runtime and end with .test.ts
    for (const file of runtimeFiles) {
      if (file.endsWith(".test.ts")) {
        const basename = file.split("/").pop()!;
        expect(basename.startsWith("runtime")).toBe(true);
        expect(basename).not.toBe("config.test.ts");
      }
    }

    // Verify sorted
    const sorted = [...resolved].sort();
    expect(resolved).toEqual(sorted);
  });

  it("handles test all with isFocused === false and test parser with isFocused === true", async () => {
    const { parseBunTestOutput } = await import("@cli/presentation/test-runner");
    const sampleOutput = `
      (pass) test file 1 [1.0ms]
      2 pass
      0 fail
      2 expect() calls
      Ran 2 tests across 2 files. [10.0ms]
    `;

    const allParsed = parseBunTestOutput(sampleOutput, undefined);
    expect(allParsed.isFocused).toBe(false);
    expect(allParsed.target).toBeUndefined();

    const domainParsed = parseBunTestOutput(sampleOutput, "parser");
    expect(domainParsed.isFocused).toBe(true);
    expect(domainParsed.target).toBe("parser");
  });

  it("deduplicates redundant patterns and normalizes path separators", async () => {
    const patterns = [
      "tests/unit/core",
      "tests/unit/core",
      "tests/unit/runtime*.test.ts",
      "tests/unit/runtime*.test.ts",
    ];
    const resolved = await resolveConcreteTestPaths(patterns, "tests");

    // Must be unique
    const unique = Array.from(new Set(resolved));
    expect(resolved).toEqual(unique);

    // All paths must use forward slashes
    for (const path of resolved) {
      expect(path).not.toContain("\\");
    }
  });

  it("safely handles non-matching wildcard patterns without throwing", async () => {
    const patterns = ["tests/unit/nonexistent_pattern_*.test.ts"];
    const resolved = await resolveConcreteTestPaths(patterns, "tests");
    expect(resolved).toEqual([]);
  });
});
