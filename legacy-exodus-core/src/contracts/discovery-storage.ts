import { excludedPathSchema } from "./discovery";
import { analysisDispositionV1Schema } from "./discovery-projection";
import { z } from "zod";
import { moduleDependencyLayerSchema } from "@graph/dependency-graph-contracts";

import { callFlowBindingSchema, controlFlowGraphSchema, dataFlowGraphSchema } from "@flow/flow-contracts";
import { callSchema, referenceSchema, scopeSchema, semanticAnalysisSchema } from "@semantic/semantic-contracts";
import { LegacyExodusError } from "@shared/errors";
import { FactArray } from "@shared/fact-array";
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
      manifest: z.string().min(1).optional(),
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
  excludedPaths: z.array(excludedPathSchema).optional(),
  discoveredAt: z.string().datetime(),
});

export const symbolTablePayloadSchema = z.object({
  fileId: z.string().min(1).optional(),
  projectId: z.string().uuid(),
  analysisRunId: z.string().uuid().optional(),
  path: z.string(),
  symbols: factList(codeSymbolSchema),
});

export const dependencyGraphPayloadSchema = z.object({
  projectId: z.string().uuid(),
  analysisRunId: z.string().uuid().optional(),
  nodes: factList(z.object({ id: z.string(), filePath: z.string(), symbolId: z.string() })),
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
  nodes: factList(z.object({ id: z.string(), kind: z.string(), name: z.string(), filePath: z.string() })),
  edges: factList(z.object({ id: z.string(), from: z.string(), to: z.string(), relationship: z.string() })),
});

/**
 * A fact list held inline or on disk (ADR-009 step 1). A list on disk is not read here: each item is validated
 * as it is read, so a projection holds one item at a time.
 */
function factList<Item extends z.ZodTypeAny>(item: Item) {
  return z.union([
    z.array(item),
    z.custom<FactArray<unknown>>((value) => value instanceof FactArray).transform((list) => list.map((value): z.output<Item> => {
      const parsed = item.safeParse(value);
      if (!parsed.success) {
        throw new LegacyExodusError({ code: "DISCOVERY_RECORD_INVALID", message: "Stored fact is invalid.", metadata: { issues: parsed.error.issues } });
      }
      return parsed.data;
    })),
  ]);
}

export const semanticAnalysisPayloadSchema = semanticAnalysisSchema.extend({
  calls: factList(callSchema),
  references: factList(referenceSchema),
  scopes: factList(scopeSchema),
  projectId: z.string().uuid(),
  analysisRunId: z.string().uuid().optional(),
});

export const controlFlowPayloadSchema = z.object({
  projectId: z.string().uuid(),
  analysisRunId: z.string().uuid().optional(),
  graphs: factList(controlFlowGraphSchema),
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
  graphs: factList(persistedDataFlowGraphSchema),
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
