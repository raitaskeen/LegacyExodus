import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Command } from "commander";

import { formatJsonOutput } from "../output/json-output";
import { detectTerminalCapabilities } from "../presentation/capabilities";
import { TableRenderer } from "../presentation/tables";
import { LayoutRenderer } from "../presentation/layout";
import { parseBunTestOutput, TestPresenter } from "../presentation/test-runner";
import { runCommand } from "./verify";

export interface TestDomainDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly pathPatterns: readonly string[];
}

export const TEST_DOMAINS: readonly TestDomainDefinition[] = [
  {
    id: "runtime",
    name: "Runtime & Engine",
    description: "Lifecycle, engine states, event store & reducer",
    pathPatterns: ["tests/unit/core", "tests/unit/runtime*.test.ts", "tests/unit/orchestration"],
  },
  {
    id: "discovery",
    name: "Discovery",
    description: "File scanner, project detector & discovery validator",
    pathPatterns: ["tests/unit/discovery"],
  },
  {
    id: "parser",
    name: "AST Parser",
    description: "JavaScript/TypeScript parser & AST node mapping",
    pathPatterns: ["tests/unit/parser"],
  },
  {
    id: "symbols",
    name: "Symbols & Exports",
    description: "Symbol extraction, export bindings & declarations",
    pathPatterns: ["tests/unit/symbols"],
  },
  {
    id: "semantic",
    name: "Semantic Call-Graph",
    description: "Call graph builder, receiver resolution & scoping",
    pathPatterns: ["tests/unit/semantic"],
  },
  {
    id: "flow",
    name: "Flow Analysis",
    description: "Control flow (CFG) & data flow (DFG) engines",
    pathPatterns: ["tests/unit/flow"],
  },
  {
    id: "storage",
    name: "Storage & Projections",
    description: "SQLite storage, memory adapter & JSON writer",
    pathPatterns: ["tests/unit/storage", "tests/unit/projections"],
  },
  {
    id: "governance",
    name: "Governance & Fidelity",
    description: "Migration fidelity validator & ground truth contracts",
    pathPatterns: ["tests/unit/governance"],
  },
  {
    id: "plugins",
    name: "Plugin System",
    description: "Plugin registry & manifest loader",
    pathPatterns: ["tests/unit/plugins"],
  },
  {
    id: "cli",
    name: "CLI Presentation",
    description: "Theme, tables, layout & command presentation",
    pathPatterns: ["tests/unit/cli"],
  },
  {
    id: "integration",
    name: "Integration Scenarios",
    description: "End-to-end repository analysis workflows",
    pathPatterns: ["tests/integration"],
  },
  {
    id: "architecture",
    name: "Architecture Rules",
    description: "Layer boundaries & contract invariants",
    pathPatterns: ["tests/architecture"],
  },
];

export interface DomainFileCount {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly fileCount: number;
}

export async function discoverTestDomains(testsRoot = "tests"): Promise<readonly DomainFileCount[]> {
  async function countFilesInPatterns(patterns: readonly string[]): Promise<number> {
    const fileSet = new Set<string>();

    for (const pattern of patterns) {
      const fullPath = resolve(pattern.replace(/^tests/, testsRoot));
      try {
        if (pattern.includes("*")) {
          // Wildcard pattern matching against filename
          const slashIdx = pattern.lastIndexOf("/");
          const parentDir = resolve((slashIdx === -1 ? "." : pattern.slice(0, slashIdx)).replace(/^tests/, testsRoot));
          const wildcardName = slashIdx === -1 ? pattern : pattern.slice(slashIdx + 1);
          const regex = new RegExp(`^${wildcardName.replace(/\./g, "\\.").replace(/\*/g, ".*")}$`);
          const entries = await readdir(parentDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith(".test.ts") && regex.test(entry.name)) {
              fileSet.add(join(parentDir, entry.name));
            }
          }
        } else {
          const entries = await readdir(fullPath, { recursive: true, withFileTypes: true });
          for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith(".test.ts")) {
              fileSet.add(join(entry.parentPath ?? fullPath, entry.name));
            }
          }
        }
      } catch {
        // Directory may not exist in some environments
      }
    }

    return fileSet.size;
  }

  const results: DomainFileCount[] = [];
  for (const domain of TEST_DOMAINS) {
    const fileCount = await countFilesInPatterns(domain.pathPatterns);
    results.push({
      id: domain.id,
      name: domain.name,
      description: domain.description,
      fileCount,
    });
  }

  return results;
}

export function registerTestCommand(program: Command): void {
  program
    .command("test [domain]")
    .description("Explore and run LegacyExodus test suites by domain (runtime, parser, symbols, semantic, flow, etc.)")
    .option("--list", "List all available test domains and file counts")
    .option("-v, --verbose", "Emit detailed test execution output")
    .option("--json", "Emit machine-readable test results in JSON")
    .option("--bail", "Stop on first test failure")
    .option("--theme <name>", "Visual theme (classic, aurora, mono)")
    .action(async (domain: string | undefined, options: {
      readonly list?: boolean;
      readonly verbose?: boolean;
      readonly json?: boolean;
      readonly bail?: boolean;
      readonly theme?: string;
    }): Promise<void> => {
      const capabilities = detectTerminalCapabilities({ json: options.json, theme: options.theme });

      // 1. List domains mode
      if (options.list) {
        const domains = await discoverTestDomains();
        if (options.json) {
          process.stdout.write(`${formatJsonOutput({ domains })}\n`);
          return;
        }

        const layout = new LayoutRenderer(capabilities);
        const tables = new TableRenderer(capabilities);
        const header = layout.renderHeader("Test Explorer", "Domain Taxonomy");

        const rows = domains.map((d) => ({
          domain: d.id,
          name: d.name,
          files: `${d.fileCount} test file${d.fileCount === 1 ? "" : "s"}`,
          description: d.description,
        }));

        const table = tables.renderTable(
          [
            { key: "domain", header: "Domain" },
            { key: "files", header: "Files", align: "right" },
            { key: "description", header: "Description" },
          ],
          rows,
        );

        const totalFiles = domains.reduce((sum, d) => sum + d.fileCount, 0);
        const footer = `  ${layout.theme.muted(`Total: ${domains.length} domains, ${totalFiles} test files across repository.`)}`;
        const divider = layout.renderDivider();

        process.stdout.write(`${header}\n\n${table}\n\n${divider}\n${footer}\n`);
        return;
      }

      // 2. Execute test domain
      const targetDomain = domain?.toLowerCase() ?? "all";
      let testPaths: readonly string[] = [];

      if (targetDomain === "all") {
        testPaths = ["tests"];
      } else {
        const matched = TEST_DOMAINS.find((d) => d.id === targetDomain || d.name.toLowerCase().includes(targetDomain));
        if (!matched) {
          const available = TEST_DOMAINS.map((d) => d.id).join(", ");
          process.stderr.write(`Unknown test domain '${domain}'. Available domains: ${available}, all\n`);
          process.exitCode = 1;
          return;
        }
        testPaths = matched.pathPatterns;
      }

      const args = ["test", ...testPaths];
      if (options.bail) {
        args.push("--bail");
      }

      const result = await runCommand("bun", args);
      const combinedOutput = `${result.stdout}\n${result.stderr}`;
      const parsed = parseBunTestOutput(combinedOutput, targetDomain);

      if (options.verbose && !options.json) {
        const rawOutput = `${result.stdout}\n${result.stderr}`.trim();
        if (rawOutput.length > 0) {
          process.stdout.write(`${rawOutput}\n\n`);
        }
      }

      if (options.json) {
        process.stdout.write(`${formatJsonOutput(parsed)}\n`);
        if (parsed.testsFailed > 0 || result.code !== 0) {
          process.exitCode = 1;
        }
        return;
      }

      const presenter = new TestPresenter(capabilities);
      if (targetDomain === "all") {
        process.stdout.write(`${presenter.renderFullTestVerification(parsed)}\n`);
      } else {
        process.stdout.write(`${presenter.renderFocusedTest({
          target: targetDomain,
          testsPassed: parsed.testsPassed,
          testsFailed: parsed.testsFailed,
          assertionsTotal: parsed.assertionsTotal,
          durationMs: parsed.durationMs,
          failureDetails: parsed.failures,
        })}\n`);
      }

      if (parsed.testsFailed > 0 || result.code !== 0) {
        process.exitCode = 1;
      }
    });
}
