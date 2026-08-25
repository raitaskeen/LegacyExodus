import { z } from "zod";
import { LegacyExodusError } from "@shared/errors";
import type { StorageManager } from "@storage/storage-manager";
import type { StorageRecord } from "@storage/storage-record";

const discoveryPayloadSchema = z.object({
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

const symbolTablePayloadSchema = z.object({
  projectId: z.string().uuid(),
  analysisRunId: z.string().uuid().optional(),
  path: z.string(),
  symbols: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      name: z.string(),
      filePath: z.string(),
      exported: z.boolean(),
      defaultExport: z.boolean(),
      moduleSpecifier: z.string().nullable(),
      sourceSymbolName: z.string().nullable(),
    }),
  ),
});

const dependencyGraphPayloadSchema = z.object({
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

const knowledgeGraphPayloadSchema = z.object({
  projectId: z.string().uuid(),
  analysisRunId: z.string().uuid().optional(),
  nodes: z.array(z.object({ id: z.string(), kind: z.string(), name: z.string(), filePath: z.string() })),
  edges: z.array(z.object({ id: z.string(), from: z.string(), to: z.string(), relationship: z.string() })),
});

const semanticAnalysisPayloadSchema = z.object({
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

const controlFlowPayloadSchema = z.object({
  projectId: z.string().uuid(),
  analysisRunId: z.string().uuid().optional(),
  graphs: z.array(z.unknown()),
});

const dataFlowPayloadSchema = z.object({
  projectId: z.string().uuid(),
  analysisRunId: z.string().uuid().optional(),
  graphs: z.array(z.unknown()),
});

export type ProjectDiscoveryPayload = z.infer<typeof discoveryPayloadSchema>;
export type SymbolTablePayload = z.infer<typeof symbolTablePayloadSchema>;
export type DependencyGraphPayload = z.infer<typeof dependencyGraphPayloadSchema>;
export type KnowledgeGraphPayload = z.infer<typeof knowledgeGraphPayloadSchema>;

export class DiscoveryQueryService {
  public constructor(private readonly storage: StorageManager) {}

  public async getProjectDiscovery(
    projectId: string,
    analysisRunId?: string,
  ): Promise<ProjectDiscoveryPayload | null> {
    const records = await this.storage.findScoped({
      type: "project-discovery",
      projectId,
      ...(analysisRunId !== undefined ? { analysisRunId } : {}),
    });
    return this.findLatestRecord(records, discoveryPayloadSchema, projectId, analysisRunId);
  }

  public async getDiscoveredFiles(
    projectId: string,
    analysisRunId?: string,
  ): Promise<ProjectDiscoveryPayload["files"]> {
    const discovery = await this.getProjectDiscovery(projectId, analysisRunId);
    return discovery?.files ?? [];
  }

  public async getSymbolsForFile(
    projectId: string,
    filePath: string,
    analysisRunId?: string,
  ): Promise<SymbolTablePayload["symbols"]> {
    const records = await this.storage.findScoped({
      type: "symbol-table",
      projectId,
      filePath,
      ...(analysisRunId !== undefined ? { analysisRunId } : {}),
    });
    if (records.length === 0) {
      return [];
    }
    const matching = records.flatMap((record) => {
      const parsed = symbolTablePayloadSchema.safeParse(record.payload);
      if (!parsed.success) {
        throw new LegacyExodusError({
          code: "DISCOVERY_RECORD_INVALID",
          message: `Stored symbol-table record for '${filePath}' is invalid.`,
          metadata: { recordId: record.id, issues: parsed.error.issues, filePath },
        });
      }
      if (
        parsed.data.projectId === projectId &&
        (analysisRunId === undefined || parsed.data.analysisRunId === analysisRunId) &&
        parsed.data.path === filePath
      ) {
        return parsed.data.symbols;
      }
      return [];
    });

    return matching;
  }

  public async getDependencyGraph(
    projectId: string,
    analysisRunId?: string,
  ): Promise<DependencyGraphPayload | null> {
    const records = await this.storage.findScoped({
      type: "dependency-graph",
      projectId,
      ...(analysisRunId !== undefined ? { analysisRunId } : {}),
    });
    return this.findLatestRecord(records, dependencyGraphPayloadSchema, projectId, analysisRunId);
  }

  public async getKnowledgeGraph(
    projectId: string,
    analysisRunId?: string,
  ): Promise<KnowledgeGraphPayload | null> {
    const records = await this.storage.findScoped({
      type: "knowledge-graph",
      projectId,
      ...(analysisRunId !== undefined ? { analysisRunId } : {}),
    });
    return this.findLatestRecord(records, knowledgeGraphPayloadSchema, projectId, analysisRunId);
  }

  public async getSemanticAnalysis(
    projectId: string,
    analysisRunId?: string,
  ): Promise<unknown | null> {
    const records = await this.storage.findScoped({
      type: "semantic-analysis",
      projectId,
      ...(analysisRunId !== undefined ? { analysisRunId } : {}),
    });
    return this.findLatestRecord(records, semanticAnalysisPayloadSchema, projectId, analysisRunId);
  }

  public async getControlFlowAnalysis(
    projectId: string,
    analysisRunId?: string,
  ): Promise<unknown | null> {
    const records = await this.storage.findScoped({
      type: "control-flow-analysis",
      projectId,
      ...(analysisRunId !== undefined ? { analysisRunId } : {}),
    });
    return this.findLatestRecord(records, controlFlowPayloadSchema, projectId, analysisRunId);
  }

  public async getDataFlowAnalysis(
    projectId: string,
    analysisRunId?: string,
  ): Promise<unknown | null> {
    const records = await this.storage.findScoped({
      type: "data-flow-analysis",
      projectId,
      ...(analysisRunId !== undefined ? { analysisRunId } : {}),
    });
    return this.findLatestRecord(records, dataFlowPayloadSchema, projectId, analysisRunId);
  }

  private findLatestRecord<T extends { readonly projectId: string; readonly analysisRunId?: string }>(
    records: readonly StorageRecord[],
    schema: z.ZodType<T>,
    projectId: string,
    analysisRunId: string | undefined,
  ): T | null {
    if (records.length === 0) {
      return null;
    }

    const candidates: { payload: T; updatedAt: number; index: number }[] = [];
    for (let index = 0; index < records.length; index++) {
      const record = records[index]!;
      const parsed = schema.safeParse(record.payload);
      if (!parsed.success) {
        throw new LegacyExodusError({
          code: "DISCOVERY_RECORD_INVALID",
          message: `Stored ${record.type} record is invalid.`,
          metadata: { recordId: record.id, issues: parsed.error.issues },
        });
      }
      if (
        parsed.data.projectId === projectId &&
        (analysisRunId === undefined || parsed.data.analysisRunId === analysisRunId)
      ) {
        candidates.push({ payload: parsed.data, updatedAt: record.updatedAt.getTime(), index });
      }
    }

    candidates.sort((left, right) => left.updatedAt - right.updatedAt || left.index - right.index);
    return candidates.at(-1)?.payload ?? null;
  }
}
