import { z } from "zod";
import {
  discoveryPayloadSchema,
  symbolTablePayloadSchema,
  dependencyGraphPayloadSchema,
  knowledgeGraphPayloadSchema,
  semanticAnalysisPayloadSchema,
  controlFlowPayloadSchema,
  dataFlowPayloadSchema,
  analysisRunPayloadSchema,
  type ProjectDiscoveryPayload,
  type SymbolTablePayload,
  type DependencyGraphPayload,
  type KnowledgeGraphPayload,
  type SemanticAnalysisPayload,
  type ControlFlowPayload,
  type DataFlowPayload,
  type AnalysisRunPayload,
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
  AnalysisRunPayload,
};

export class DiscoveryQueryService {
  public constructor(private readonly storage: StorageManager) {}

  public async getLatestCompletedRunId(projectId: string): Promise<string | null> {
    const runRecords = await this.storage.findScoped({
      type: "analysis-run",
      projectId,
    });

    if (runRecords.length > 0) {
      const completed = runRecords
        .map((r) => {
          const parsed = analysisRunPayloadSchema.safeParse(r.payload);
          return parsed.success && parsed.data.status === "completed" && parsed.data.projectId === projectId
            ? { payload: parsed.data, updatedAt: r.updatedAt.getTime() }
            : null;
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .sort((a, b) => a.updatedAt - b.updatedAt);

      return completed.at(-1)?.payload.analysisRunId ?? null;
    }

    const discoveryRecords = await this.storage.findScoped({
      type: "project-discovery",
      projectId,
    });
    const latest = this.findLatestRecord(discoveryRecords, discoveryPayloadSchema, projectId, undefined);
    return latest?.analysisRunId ?? null;
  }

  public async getAnalysisRun(
    projectId: string,
    analysisRunId?: string,
  ): Promise<AnalysisRunPayload | null> {
    const records = await this.storage.findScoped({
      type: "analysis-run",
      projectId,
      ...(analysisRunId !== undefined ? { analysisRunId } : {}),
    });
    return this.findLatestRecord(records, analysisRunPayloadSchema, projectId, analysisRunId);
  }

  public async listAnalysisRuns(projectId: string): Promise<readonly AnalysisRunPayload[]> {
    const records = await this.storage.findScoped({
      type: "analysis-run",
      projectId,
    });
    const runs = records
      .map((r) => {
        const parsed = analysisRunPayloadSchema.safeParse(r.payload);
        if (!parsed.success) {
          throw new LegacyExodusError({
            code: "DISCOVERY_RECORD_INVALID",
            message: "Stored analysis-run record is invalid.",
            metadata: { recordId: r.id, issues: parsed.error.issues },
          });
        }
        return parsed.data.projectId === projectId ? { payload: parsed.data, updatedAt: r.updatedAt.getTime() } : null;
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => a.updatedAt - b.updatedAt);

    return runs.map((r) => r.payload);
  }

  public async getProjectDiscovery(
    projectId: string,
    analysisRunId?: string,
  ): Promise<ProjectDiscoveryPayload | null> {
    const targetRunId = analysisRunId ?? (await this.getLatestCompletedRunId(projectId));
    if (targetRunId === null) {
      return null;
    }
    const records = await this.storage.findScoped({
      type: "project-discovery",
      projectId,
      analysisRunId: targetRunId,
    });
    return this.findLatestRecord(records, discoveryPayloadSchema, projectId, targetRunId);
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
    const targetRunId = analysisRunId ?? (await this.getLatestCompletedRunId(projectId));
    if (targetRunId === null) {
      return [];
    }
    const records = await this.storage.findScoped({
      type: "symbol-table",
      projectId,
      filePath,
      analysisRunId: targetRunId,
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
        parsed.data.analysisRunId === targetRunId &&
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
    const targetRunId = analysisRunId ?? (await this.getLatestCompletedRunId(projectId));
    if (targetRunId === null) {
      return null;
    }
    const records = await this.storage.findScoped({
      type: "dependency-graph",
      projectId,
      analysisRunId: targetRunId,
    });
    return this.findLatestRecord(records, dependencyGraphPayloadSchema, projectId, targetRunId);
  }

  public async getKnowledgeGraph(
    projectId: string,
    analysisRunId?: string,
  ): Promise<KnowledgeGraphPayload | null> {
    const targetRunId = analysisRunId ?? (await this.getLatestCompletedRunId(projectId));
    if (targetRunId === null) {
      return null;
    }
    const records = await this.storage.findScoped({
      type: "knowledge-graph",
      projectId,
      analysisRunId: targetRunId,
    });
    return this.findLatestRecord(records, knowledgeGraphPayloadSchema, projectId, targetRunId);
  }

  public async getSemanticAnalysis(
    projectId: string,
    analysisRunId?: string,
  ): Promise<unknown | null> {
    const targetRunId = analysisRunId ?? (await this.getLatestCompletedRunId(projectId));
    if (targetRunId === null) {
      return null;
    }
    const records = await this.storage.findScoped({
      type: "semantic-analysis",
      projectId,
      analysisRunId: targetRunId,
    });
    return this.findLatestRecord(records, semanticAnalysisPayloadSchema, projectId, targetRunId);
  }

  public async getControlFlowAnalysis(
    projectId: string,
    analysisRunId?: string,
  ): Promise<unknown | null> {
    const targetRunId = analysisRunId ?? (await this.getLatestCompletedRunId(projectId));
    if (targetRunId === null) {
      return null;
    }
    const records = await this.storage.findScoped({
      type: "control-flow-analysis",
      projectId,
      analysisRunId: targetRunId,
    });
    return this.findLatestRecord(records, controlFlowPayloadSchema, projectId, targetRunId);
  }

  public async getDataFlowAnalysis(
    projectId: string,
    analysisRunId?: string,
  ): Promise<unknown | null> {
    const targetRunId = analysisRunId ?? (await this.getLatestCompletedRunId(projectId));
    if (targetRunId === null) {
      return null;
    }
    const records = await this.storage.findScoped({
      type: "data-flow-analysis",
      projectId,
      analysisRunId: targetRunId,
    });
    return this.findLatestRecord(records, dataFlowPayloadSchema, projectId, targetRunId);
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
