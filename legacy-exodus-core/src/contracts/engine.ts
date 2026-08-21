import { z } from "zod";

import type { EngineStatus } from "@core/engine/engine-status";
import type { ProjectDiscovery } from "@contracts/discovery";
import type { AnalyzeProjectCommand } from "./commands";

export interface SystemStatusCommand {
  readonly id: string;
  readonly type: "SystemStatus";
  readonly createdAt: Date;
}

export type EngineCommand = SystemStatusCommand | AnalyzeProjectCommand;

export interface SystemStatusResult {
  readonly type: "SystemStatus";
  readonly status: EngineStatus;
}

export interface AnalyzeProjectResult {
  readonly type: "AnalyzeProject";
  readonly discovery: ProjectDiscovery;
  readonly analysis: AnalysisSummary;
}

export interface AnalysisSummary {
  readonly filesDiscovered: number;
  readonly filesAnalyzed: number;
  readonly parserFailures: number;
  readonly symbolExtractionFailures: number;
  /** Source files whose language is not supported by the active parser runtime. */
  readonly unsupportedFiles: number;
  /** Discovered artifacts intentionally outside source-code analysis (manifests, docs, styles, data, etc.). */
  readonly nonSourceArtifacts: number;
  /** Discovered files whose kind or language cannot be confidently classified. */
  readonly unclassifiedArtifacts: number;
  /** Monotonic wall-clock observation; never persisted in deterministic analysis artifacts. */
  readonly durationMs: number;
}

const analysisSummarySchema = z.object({
  filesDiscovered: z.number().int().nonnegative(),
  filesAnalyzed: z.number().int().nonnegative(),
  parserFailures: z.number().int().nonnegative(),
  symbolExtractionFailures: z.number().int().nonnegative(),
  unsupportedFiles: z.number().int().nonnegative(),
  nonSourceArtifacts: z.number().int().nonnegative(),
  unclassifiedArtifacts: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
}).strict();

/** Creates the concise, machine-readable disposition summary for one analysis run. */
export function createAnalysisSummary(summary: AnalysisSummary): AnalysisSummary {
  return Object.freeze(analysisSummarySchema.parse(summary));
}

export type EngineResult = SystemStatusResult | AnalyzeProjectResult;
