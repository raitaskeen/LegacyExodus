import { z } from "zod";
import {
  discoveryPayloadSchema,
  symbolTablePayloadSchema,
  dependencyGraphPayloadSchema,
  knowledgeGraphPayloadSchema,
  semanticAnalysisPayloadSchema,
  controlFlowPayloadSchema,
  dataFlowPayloadSchema,
  type ProjectDiscoveryPayload,
  type SymbolTablePayload,
  type DependencyGraphPayload,
  type KnowledgeGraphPayload,
  type SemanticAnalysisPayload,
  type ControlFlowPayload,
  type DataFlowPayload,
} from "@contracts/discovery-storage";
import { LegacyExodusError } from "@shared/errors";
import type { StorageManager } from "@storage/storage-manager";
import type { StorageRecord } from "@storage/storage-record";

export type {
  ProjectDiscoveryPayload,
  SymbolTablePayload,
  DependencyGraphPayload,
  KnowledgeGraphPayload,
  SemanticAnalysisPayload,
  ControlFlowPayload,
  DataFlowPayload,
};

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
