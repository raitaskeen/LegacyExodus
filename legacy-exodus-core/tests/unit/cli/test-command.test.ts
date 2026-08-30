import { describe, expect, it } from "bun:test";
import { Command } from "commander";

import {
  discoverTestDomains,
  registerTestCommand,
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
});
