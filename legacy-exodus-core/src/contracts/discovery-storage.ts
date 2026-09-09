import { z } from "zod";

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
  discoveredAt: z.string().datetime(),
});

export const symbolTablePayloadSchema = z.object({
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
});

export const knowledgeGraphPayloadSchema = z.object({
  projectId: z.string().uuid(),
  analysisRunId: z.string().uuid().optional(),
  nodes: z.array(z.object({ id: z.string(), kind: z.string(), name: z.string(), filePath: z.string() })),
  edges: z.array(z.object({ id: z.string(), from: z.string(), to: z.string(), relationship: z.string() })),
});

export const semanticAnalysisPayloadSchema = z.object({
  projectId: z.string().uuid(),
  analysisRunId: z.string().uuid().optional(),
  calls: z.array(z.unknown()).optional(),
  references: z.array(z.unknown()).optional(),
  scopes: z.array(z.unknown()).optional(),
  deadCode: z.array(z.unknown()).optional(),
  unusedImports: z.array(z.unknown()).optional(),
  unusedExports: z.array(z.unknown()).optional(),
  entryPoints: z.array(z.unknown()).optional(),
  routes: z.array(z.unknown()).optional(),
  middlewareChains: z.array(z.unknown()).optional(),
});

export const controlFlowPayloadSchema = z.object({
  projectId: z.string().uuid(),
  analysisRunId: z.string().uuid().optional(),
  graphs: z.array(z.unknown()),
});

export const dataFlowPayloadSchema = z.object({
  projectId: z.string().uuid(),
  analysisRunId: z.string().uuid().optional(),
  graphs: z.array(z.unknown()),
});

export const analysisRunStatusSchema = z.enum(["created", "running", "completed", "failed"]);

export const analysisRunPayloadSchema = z.object({
  projectId: z.string().uuid(),
  analysisRunId: z.string().uuid(),
  status: analysisRunStatusSchema,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  error: z.string().optional(),
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
      durationMs: z.number().nonnegative(),
    })
    .optional(),
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
