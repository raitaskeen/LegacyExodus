import { randomUUID } from "node:crypto";

import type { Command } from "commander";

import { createLegacyExodusEngine, type LegacyExodusEngine } from "@core/engine";

import { formatAnalyzeOutput } from "../output/formatter";
import { formatJsonOutput } from "../output/json-output";

export interface AnalyzeProjectReport {
  readonly projectName: string;
  readonly files: number;
  readonly languages: readonly string[];
  readonly frameworks: readonly string[];
  readonly dependencies: number;
}

export async function analyzeProject(
  path: string,
  createEngine: () => LegacyExodusEngine = createLegacyExodusEngine,
): Promise<AnalyzeProjectReport> {
  const engine = createEngine();

  await engine.initialize();

  try {
    const result = await engine.execute({
      id: randomUUID(),
      type: "AnalyzeProject",
      createdAt: new Date(),
      payload: { projectId: randomUUID(), path },
    });

    if (result.type !== "AnalyzeProject") {
      throw new Error("AnalyzeProject returned an unexpected engine result.");
    }

    return {
      projectName: result.discovery.projectName,
      files: result.discovery.files.length,
      languages: result.discovery.languages,
      frameworks: result.discovery.frameworks.map((framework) => framework.name),
      dependencies: result.discovery.dependencies.length,
    };
  } finally {
    await engine.shutdown();
  }
}

export function registerAnalyzeCommand(
  program: Command,
  createEngine: () => LegacyExodusEngine,
): void {
  program
    .command("analyze <path>")
    .description("Observe a project and create a deterministic discovery inventory")
    .option("--json", "Emit machine-readable JSON")
    .action(async (path: string, options: { readonly json?: boolean }): Promise<void> => {
      const report = await analyzeProject(path, createEngine);
      const output = options.json ? formatJsonOutput(report) : formatAnalyzeOutput(report);

      process.stdout.write(`${output}\n`);
    });
}
