import { analysisDispositionV1Schema } from "./discovery-projection";
import { z } from "zod";
import { moduleDependencyLayerSchema } from "@graph/dependency-graph-contracts";

import { callFlowBindingSchema, controlFlowGraphSchema, dataFlowGraphSchema } from "@flow/flow-contracts";
import { semanticAnalysisSchema } from "@semantic/semantic-contracts";
import { codeSymbolSchema } from "@symbols/symbol-contracts";

export const discoveryPayloadSchema = z.object({
  projectId: z.string().uuid(),
  analysisRunId: z.string().uuid().optional(),
  projectName: z.string().min(1),
  projectPath: z.string().min(1),
  files: z.array(
    z.object({
      id: z.string().min(1),
      path: z.string().min(1),
      language: z.string().min(1),
      fileKind: z.string().min(1).optional(),
      size: z.number().nonnegative(),
    }),
  ),
  dependencies: z.array(
    z.object({
      name: z.string().min(1),
      version: z.string().min(1),
      kind: z.enum(["production", "development"]),
    }),
  ),
  frameworks: z.array(z.object({ name: z.string().min(1), evidence: z.string().min(1) })),
  languages: z.array(z.string().min(1)),
  enumerationFailures: z
    .array(
      z.object({
        path: z.string().min(1),
        kind: z.enum(["directory-read", "entry-stat"]),
        code: z.string().min(1),
      }),
    )
    .optional(),
  manifestFailures: z
    .array(
      z.object({
        path: z.literal("package.json"),
        kind: z.enum(["manifest-read", "manifest-parse", "manifest-validation"]),
        code: z.string().min(1),
      }),
    )
    .optional(),
  discoveredAt: z.string().datetime(),
});

export const symbolTablePayloadSchema = z.object({
  fileId: z.string().min(1).optional(),
  projectId: z.string().uuid(),
  analysisRunId: z.string().uuid().optional(),
  path: z.string(),
  symbols: z.array(codeSymbolSchema),
});

export const dependencyGraphPayloadSchema = z.object({
  projectId: z.string().uuid(),
  analysisRunId: z.string().uuid().optional(),
  nodes: z.array(z.object({ id: z.string(), filePath: z.string(), symbolId: z.string() })),
  edges: z.array(
    z.object({
      id: z.string(),
      sourceFilePath: z.string(),
      targetFilePath: z.string(),
      importSymbolId: z.string(),
      targetExportSymbolId: z.string(),
      moduleSpecifier: z.string(),
    }),
  ),
  cycles: z.array(z.array(z.string())),
  moduleGraph: moduleDependencyLayerSchema.optional(),
}).refine((graph) => !Object.hasOwn(graph, "moduleGraph") || graph.moduleGraph !== undefined, "Present moduleGraph must satisfy the current contract.");

export const knowledgeGraphPayloadSchema = z.object({
  projectId: z.string().uuid(),
  analysisRunId: z.string().uuid().optional(),
  nodes: z.array(z.object({ id: z.string(), kind: z.string(), name: z.string(), filePath: z.string() })),
  edges: z.array(z.object({ id: z.string(), from: z.string(), to: z.string(), relationship: z.string() })),
});

export const semanticAnalysisPayloadSchema = semanticAnalysisSchema.extend({
  projectId: z.string().uuid(),
  analysisRunId: z.string().uuid().optional(),
});

export const controlFlowPayloadSchema = z.object({
  projectId: z.string().uuid(),
  analysisRunId: z.string().uuid().optional(),
  graphs: z.array(controlFlowGraphSchema),
});

const persistedCallFlowBindingSchema = callFlowBindingSchema.extend({
  argumentDefinitionIds: z.array(z.string().min(1).nullable()),
  argumentSourceIds: z.array(z.string().min(1).nullable()).optional(),
});
const persistedDataFlowGraphSchema = dataFlowGraphSchema.extend({
  callBindings: z.array(persistedCallFlowBindingSchema),
});

export const dataFlowPayloadSchema = z.object({
  projectId: z.string().uuid(),
  analysisRunId: z.string().uuid().optional(),
  graphs: z.array(persistedDataFlowGraphSchema),
});

export const analysisRunStatusSchema = z.enum(["created", "running", "completed", "failed"]);

export const analysisRunPayloadSchema = z.object({
  projectId: z.string().uuid(),
  analysisRunId: z.string().uuid(),
  status: analysisRunStatusSchema,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  error: z.string().optional(),
  analysisDisposition: analysisDispositionV1Schema.optional(),
  summary: z
    .object({
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
    })
    .optional(),
}).superRefine((run, context) => {
  if (run.analysisDisposition === undefined) return; // Historical record, no optimistic upgrade.
  const files = run.analysisDisposition.files;
  const summary = run.summary;
  const analyzed = files.filter((file) => file.kind === "analyzed");
  if (run.status !== "completed" || summary === undefined ||
    new Set(files.map((file) => file.fileId)).size !== files.length ||
    new Set(files.map((file) => file.path)).size !== files.length ||
    summary.filesAnalyzed !== analyzed.length ||
    summary.parserFailures !== files.filter((file) => file.kind === "initial-parser-failure").length ||
    summary.symbolExtractionFailures !== files.filter((file) => file.kind === "symbol-extraction-failure").length ||
    summary.secondPassFailures !== analyzed.filter((file) => file.secondPassFailure !== undefined).length ||
    summary.filesDiscovered !== summary.filesAnalyzed + summary.parserFailures + summary.symbolExtractionFailures +
      summary.unsupportedFiles + summary.nonSourceArtifacts + summary.unclassifiedArtifacts) {
    context.addIssue({ code: "custom", message: "Current R01 run disposition and summary must reconcile." });
  }
});

export const astResultPayloadSchema = z.object({
  projectId: z.string().uuid(),
  analysisRunId: z.string().uuid().optional(),
  fileId: z.string().min(1),
  path: z.string().min(1),
  parserId: z.string().min(1),
  nodeCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
});

export type ProjectDiscoveryPayload = z.infer<typeof discoveryPayloadSchema>;
export type AstResultPayload = z.infer<typeof astResultPayloadSchema>;
export type SymbolTablePayload = z.infer<typeof symbolTablePayloadSchema>;
export type DependencyGraphPayload = z.infer<typeof dependencyGraphPayloadSchema>;
export type KnowledgeGraphPayload = z.infer<typeof knowledgeGraphPayloadSchema>;
export type SemanticAnalysisPayload = z.infer<typeof semanticAnalysisPayloadSchema>;
export type ControlFlowPayload = z.infer<typeof controlFlowPayloadSchema>;
export type DataFlowPayload = z.infer<typeof dataFlowPayloadSchema>;
export type AnalysisRunStatus = z.infer<typeof analysisRunStatusSchema>;
export type AnalysisRunPayload = z.infer<typeof analysisRunPayloadSchema>;
