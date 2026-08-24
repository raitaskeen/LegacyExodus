import { z } from "zod";
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
    const records = await this.storage.findAll("project-discovery");
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
    const records = await this.storage.findAll("symbol-table");
    const matching = records.flatMap((record) => {
      const parsed = symbolTablePayloadSchema.safeParse(record.payload);
      if (
        parsed.success &&
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
    const records = await this.storage.findAll("dependency-graph");
    return this.findLatestRecord(records, dependencyGraphPayloadSchema, projectId, analysisRunId);
  }

  public async getKnowledgeGraph(
    projectId: string,
    analysisRunId?: string,
  ): Promise<KnowledgeGraphPayload | null> {
    const records = await this.storage.findAll("knowledge-graph");
    return this.findLatestRecord(records, knowledgeGraphPayloadSchema, projectId, analysisRunId);
  }

  public async getSemanticAnalysis(
    projectId: string,
    analysisRunId?: string,
  ): Promise<unknown | null> {
    const records = await this.storage.findAll("semantic-analysis");
    const matched = records.find((r) => {
      if (typeof r.payload === "object" && r.payload !== null) {
        const p = r.payload as Record<string, unknown>;
        return p.projectId === projectId && (analysisRunId === undefined || p.analysisRunId === analysisRunId);
      }
      return false;
    });

    return matched?.payload ?? null;
  }

  public async getControlFlowAnalysis(
    projectId: string,
    analysisRunId?: string,
  ): Promise<unknown | null> {
    const records = await this.storage.findAll("control-flow-analysis");
    const matched = records.find((r) => {
      if (typeof r.payload === "object" && r.payload !== null) {
        const p = r.payload as Record<string, unknown>;
        return p.projectId === projectId && (analysisRunId === undefined || p.analysisRunId === analysisRunId);
      }
      return false;
    });

    return matched?.payload ?? null;
  }

  public async getDataFlowAnalysis(
    projectId: string,
    analysisRunId?: string,
  ): Promise<unknown | null> {
    const records = await this.storage.findAll("data-flow-analysis");
    const matched = records.find((r) => {
      if (typeof r.payload === "object" && r.payload !== null) {
        const p = r.payload as Record<string, unknown>;
        return p.projectId === projectId && (analysisRunId === undefined || p.analysisRunId === analysisRunId);
      }
      return false;
    });

    return matched?.payload ?? null;
  }

  private findLatestRecord<T extends { readonly projectId: string; readonly analysisRunId?: string }>(
    records: readonly StorageRecord[],
    schema: z.ZodType<T>,
    projectId: string,
    analysisRunId: string | undefined,
  ): T | null {
    const candidates = records.flatMap((record, index) => {
      const parsed = schema.safeParse(record.payload);
      if (
        parsed.success &&
        parsed.data.projectId === projectId &&
        (analysisRunId === undefined || parsed.data.analysisRunId === analysisRunId)
      ) {
        return [{ payload: parsed.data, updatedAt: record.updatedAt.getTime(), index }];
      }
      return [];
    });

    candidates.sort((left, right) => left.updatedAt - right.updatedAt || left.index - right.index);
    return candidates.at(-1)?.payload ?? null;
  }
}
