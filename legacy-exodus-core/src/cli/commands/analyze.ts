import { randomUUID } from "node:crypto";

import type { Command } from "commander";

import { createLegacyExodusEngine, type LegacyExodusEngine } from "@core/engine";

import { formatJsonOutput } from "../output/json-output";
import { UnexpectedEngineResultError } from "../errors";
import { detectTerminalCapabilities } from "../presentation/capabilities";
import { SummaryPresenter } from "../presentation/summaries";

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
  readonly unclassifiedArtifacts: number;
  readonly enumerationFailures?: number;
  readonly discoveryComplete?: boolean;
  readonly durationMs: number;
  /** True when results were restored from an authenticated `.discovery` snapshot instead of fresh analysis. */
  readonly reused?: boolean;
  /** Analysis run that produced the reused snapshot. */
  readonly snapshotAnalysisRunId?: string;
}

export interface AnalyzeProjectOptions {
  readonly refresh?: boolean;
  readonly storageDriver?: string;
  readonly storagePath?: string;
}

export async function analyzeProject(
  path: string,
  createEngine: (env?: Record<string, string | undefined>) => LegacyExodusEngine = createLegacyExodusEngine,
  options: AnalyzeProjectOptions = {},
): Promise<AnalyzeProjectReport> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...(options.storageDriver ? { LEGACY_EXODUS_STORAGE_DRIVER: options.storageDriver } : {}),
    ...(options.storagePath ? { LEGACY_EXODUS_STORAGE_DB_PATH: options.storagePath } : {}),
  };
  const engine = createEngine(env);

  await engine.initialize();

  try {
    const result = await engine.execute({
      id: randomUUID(),
      type: "AnalyzeProject",
      createdAt: new Date(),
      payload: { projectId: randomUUID(), path, ...(options.refresh ? { refresh: true } : {}) },
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
      unclassifiedArtifacts: result.analysis.unclassifiedArtifacts,
      enumerationFailures: result.analysis.enumerationFailures ?? 0,
      discoveryComplete: result.analysis.discoveryComplete ?? true,
      durationMs: result.analysis.durationMs,
      reused: result.isReused === true,
      ...(result.isReused === true && result.snapshotAnalysisRunId !== undefined
        ? { snapshotAnalysisRunId: result.snapshotAnalysisRunId }
        : {}),
    };
  } finally {
    await engine.shutdown();
  }
}

export function registerAnalyzeCommand(
  program: Command,
  createEngine: (env?: Record<string, string | undefined>) => LegacyExodusEngine,
): void {
  program
    .command("analyze <path>")
    .description("Observe a project and create a deterministic discovery inventory")
    .option("--json", "Emit machine-readable JSON")
    .option("--theme <name>", "Visual theme (classic, aurora, mono)")
    .option("--refresh", "Force fresh discovery and bypass existing snapshot reuse")
    .option("--storage-driver <driver>", "Storage driver to use (memory, sqlite)")
    .option("--storage-path <path>", "Database file path for SQLite storage")
    .action(
      async (
        path: string,
        options: {
          readonly json?: boolean;
          readonly theme?: string;
          readonly refresh?: boolean;
          readonly storageDriver?: string;
          readonly storagePath?: string;
        },
      ): Promise<void> => {
        const report = await analyzeProject(path, createEngine, options);
        if (options.json) {
          process.stdout.write(`${formatJsonOutput(report)}\n`);
          return;
        }

        const capabilities = detectTerminalCapabilities({ json: options.json, theme: options.theme });
        const presenter = new SummaryPresenter(capabilities);
        process.stdout.write(`${presenter.formatAnalyze(report)}\n`);
      },
    );
}
