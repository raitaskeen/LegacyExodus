import { randomUUID } from "node:crypto";

import type { Command } from "commander";

import { createLegacyExodusEngine, type LegacyExodusEngine } from "@core/engine";

import { formatAnalyzeOutput } from "../output/formatter";
import { formatJsonOutput } from "../output/json-output";
import { UnexpectedEngineResultError } from "../errors";

export interface AnalyzeProjectReport {
  readonly projectName: string;
  /** Compatibility field retained for existing CLI consumers. */
  readonly files: number;
  readonly filesDiscovered: number;
  readonly languages: readonly string[];
  readonly frameworks: readonly string[];
  readonly dependencies: number;
  readonly filesAnalyzed: number;
  readonly parserFailures: number;
  readonly symbolExtractionFailures: number;
  /** Source files whose language has no parser registered in this runtime. */
  readonly unsupportedFiles: number;
  readonly nonSourceArtifacts: number;
  readonly durationMs: number;
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
      throw new UnexpectedEngineResultError("AnalyzeProject", result.type);
    }

    return {
      projectName: result.discovery.projectName,
      files: result.discovery.files.length,
      filesDiscovered: result.analysis.filesDiscovered,
      languages: result.discovery.languages,
      frameworks: result.discovery.frameworks.map((framework) => framework.name),
      dependencies: result.discovery.dependencies.length,
      filesAnalyzed: result.analysis.filesAnalyzed,
      parserFailures: result.analysis.parserFailures,
      symbolExtractionFailures: result.analysis.symbolExtractionFailures,
      unsupportedFiles: result.analysis.unsupportedFiles,
      nonSourceArtifacts: result.analysis.nonSourceArtifacts,
      durationMs: result.analysis.durationMs,
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
