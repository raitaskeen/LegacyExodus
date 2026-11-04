import { z } from "zod";

import type { EngineStatus } from "@core/engine/engine-status";
import type { ProjectDiscovery } from "@contracts/discovery";
import type { AnalyzeProjectCommand } from "./commands";
import { immutable } from "@shared/immutability";

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
  readonly isReused?: boolean;
  /** Analysis run that produced the reused snapshot; present only with `isReused`. */
  readonly snapshotAnalysisRunId?: string;
}

export interface AnalysisSummary {
  readonly filesDiscovered: number;
  /** Distinct discovered files with a successfully produced symbol table, including empty tables. */
  readonly filesAnalyzed: number;
  readonly parserFailures: number;
  readonly symbolExtractionFailures: number;
  /** Source files whose language is not supported by the active parser runtime. */
  readonly unsupportedFiles: number;
  /** Discovered artifacts intentionally outside source-code analysis (manifests, docs, styles, data, etc.). */
  readonly nonSourceArtifacts: number;
  /** Discovered files whose kind or language cannot be confidently classified. */
  readonly unclassifiedArtifacts: number;
  /** Number of filesystem enumeration failures encountered during discovery traversal. */
  readonly enumerationFailures?: number;
  /** Distinct analyzed files whose second-pass AST restoration failed; outside primary accounting. */
  readonly secondPassFailures?: number;
  /** True when discovery has neither enumeration nor manifest failures. */
  readonly discoveryComplete?: boolean;
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
  enumerationFailures: z.number().int().nonnegative().optional(),
  discoveryComplete: z.boolean().optional(),
  secondPassFailures: z.number().int().nonnegative().optional(),
  durationMs: z.number().nonnegative(),
}).strict().refine((summary) => (summary.secondPassFailures ?? 0) <= summary.filesAnalyzed, "Second-pass failures cannot exceed analyzed files.");

/** Creates the concise, machine-readable disposition summary for one analysis run. */
export function createAnalysisSummary(summary: AnalysisSummary): AnalysisSummary {
  const parsed = analysisSummarySchema.parse(summary);
  const enumerationFailures = parsed.enumerationFailures ?? 0;
  const discoveryComplete = parsed.discoveryComplete ?? (enumerationFailures === 0);
  return immutable({
    ...parsed,
    enumerationFailures,
    discoveryComplete,
  });
}

export type EngineResult = SystemStatusResult | AnalyzeProjectResult;
