import { z } from "zod";

import { createDiscoveryProjection, validateAnalysisDisposition, type DiscoveryProjection } from "@contracts/discovery-projection";
import {
  analysisRunPayloadSchema,
  discoveryPayloadSchema as discoveryStoragePayloadSchema,
  dependencyGraphPayloadSchema as dependencyGraphStoragePayloadSchema,
  symbolTablePayloadSchema as symbolTableStoragePayloadSchema,
  knowledgeGraphPayloadSchema as knowledgeGraphStoragePayloadSchema,
  semanticAnalysisPayloadSchema as semanticAnalysisStoragePayloadSchema,
  controlFlowPayloadSchema as controlFlowStoragePayloadSchema,
  dataFlowPayloadSchema as dataFlowStoragePayloadSchema,
} from "@contracts/discovery-storage";
import { LegacyExodusError } from "@shared/errors";
import type { RuntimeService } from "@runtime/application";
import type { StorageRecord } from "@storage/storage-record";
import type { StorageManager } from "@storage/storage-manager";

import { FileDiscoveryProjectionAdapter } from "./file-discovery-projection";

type RunScopedPayload = { readonly projectId: string; readonly analysisRunId?: string };

export class DiscoveryProjectionService implements RuntimeService {
  public readonly name = "discovery-projection";
  private readonly activeProjections = new Set<Promise<unknown>>();
  private status: "ready" | "stopped" = "ready";

  public constructor(
    private readonly storage: StorageManager,
    private readonly adapter: FileDiscoveryProjectionAdapter,
  ) {}

  public async project(recordId: string): Promise<DiscoveryProjection> {
    if (this.status === "stopped") {
      throw new LegacyExodusError({
        code: "PROJECTION_SERVICE_STOPPED",
        message: "Discovery projection service has been stopped.",
      });
    }

    const task = (async () => {
      const record = await this.storage.findById(recordId);
      if (record === null || record.type !== "project-discovery") {
        throw new LegacyExodusError({ code: "DISCOVERY_RECORD_NOT_FOUND", message: "Stored discovery record was not found.", metadata: { recordId } });
      }

      const discovery = discoveryStoragePayloadSchema.safeParse(record.payload);
      if (!discovery.success) {
        throw new LegacyExodusError({ code: "DISCOVERY_RECORD_INVALID", message: "Stored discovery record is invalid.", metadata: { issues: discovery.error.issues, recordId } });
      }

    const payload = discovery.data;
    const runCriteria = {
      projectId: payload.projectId,
      ...(payload.analysisRunId !== undefined ? { analysisRunId: payload.analysisRunId } : {}),
    };
    const [graphRecords, symbolRecords, knowledgeRecords, semanticRecords, controlFlowRecords, dataFlowRecords, runRecords] = await Promise.all([
      this.storage.findScoped({ type: "dependency-graph", ...runCriteria }),
      this.storage.findScoped({ type: "symbol-table", ...runCriteria }),
      this.storage.findScoped({ type: "knowledge-graph", ...runCriteria }),
      this.storage.findScoped({ type: "semantic-analysis", ...runCriteria }),
      this.storage.findScoped({ type: "control-flow-analysis", ...runCriteria }),
      this.storage.findScoped({ type: "data-flow-analysis", ...runCriteria }),
      this.storage.findScoped({ type: "analysis-run", ...runCriteria }),
    ]);
    const graph = latestPayload(graphRecords, dependencyGraphStoragePayloadSchema, payload.projectId, payload.analysisRunId);
    const knowledge = latestPayload(knowledgeRecords, knowledgeGraphStoragePayloadSchema, payload.projectId, payload.analysisRunId);
    const semantic = latestPayload(semanticRecords, semanticAnalysisStoragePayloadSchema, payload.projectId, payload.analysisRunId);
    const controlFlow = latestPayload(controlFlowRecords, controlFlowStoragePayloadSchema, payload.projectId, payload.analysisRunId);
    const dataFlow = latestPayload(dataFlowRecords, dataFlowStoragePayloadSchema, payload.projectId, payload.analysisRunId);
    const tables = symbolRecords
      .map((candidate) => {
        const parsed = symbolTableStoragePayloadSchema.safeParse(candidate.payload);
        if (!parsed.success) {
          throw new LegacyExodusError({
            code: "DISCOVERY_RECORD_INVALID",
            message: "Stored symbol-table record is invalid.",
            metadata: { issues: parsed.error.issues, recordId: candidate.id },
          });
        }
        return matchesRun(parsed.data, payload.projectId, payload.analysisRunId) ? parsed.data : undefined;
      })
      .filter((candidate): candidate is z.infer<typeof symbolTableStoragePayloadSchema> => candidate !== undefined)
      .sort((left, right) => left.path.localeCompare(right.path));
    const symbols = tables.flatMap((candidate) => candidate.symbols);
    // Historical discovery/analysis projections remain readable. Only an exact,
    // unambiguous current completed run can authorize the R01 capability.
    const matchingRuns = runRecords.filter((record) => {
      const identity = z.object({ projectId: z.string(), analysisRunId: z.string() }).parse(record.payload);
      return payload.analysisRunId !== undefined && matchesRun(identity, payload.projectId, payload.analysisRunId);
    });
    if (matchingRuns.length > 1) {
      throw new LegacyExodusError({ code: "R01_DISPOSITION_INVALID", message: "Ambiguous matching analysis run." });
    }
    const run = matchingRuns.length === 0 ? undefined : analysisRunPayloadSchema.parse(matchingRuns[0]!.payload);
    if (run?.analysisDisposition !== undefined && run.status !== "completed") {
      throw new LegacyExodusError({ code: "R01_DISPOSITION_INVALID", message: "Current disposition requires a completed run." });
    }
    const analysisDisposition = run?.analysisDisposition === undefined ? undefined : validateAnalysisDisposition(run.analysisDisposition, {
      files: payload.files,
      symbols,
      tables,
      summary: run.summary,
      enumerationFailures: (payload.enumerationFailures ?? []).length,
      manifestFailures: (payload.manifestFailures ?? []).length,
    });


    const projection = createDiscoveryProjection({
      projectPath: payload.projectPath,
      artifacts: [
        {
          name: "project.json",
          payload: {
            name: payload.projectName,
            path: payload.projectPath,
            languages: payload.languages,
            ...(payload.manifestFailures && payload.manifestFailures.length > 0
              ? { manifestFailures: payload.manifestFailures }
              : {}),
          },
        },
        { name: "files.json", payload: payload.files },
        { name: "dependencies.json", payload: payload.dependencies },
        { name: "frameworks.json", payload: payload.frameworks },
        {
          name: "summary.json",
          payload: {
            ...(analysisDisposition === undefined ? {} : { analysisDisposition }),
            projectName: payload.projectName,
            fileCount: payload.files.length,
            dependencyCount: payload.dependencies.length,
            frameworkCount: payload.frameworks.length,
            languages: payload.languages,
            enumerationFailureCount: (payload.enumerationFailures ?? []).length,
            ...(payload.manifestFailures && payload.manifestFailures.length > 0
              ? { manifestFailureCount: payload.manifestFailures.length }
              : {}),
            discoveryComplete:
              (payload.enumerationFailures ?? []).length === 0 &&
              (payload.manifestFailures ?? []).length === 0,
          },
        },
        ...(payload.enumerationFailures && payload.enumerationFailures.length > 0
          ? [{ name: "enumeration-failures.json" as const, payload: payload.enumerationFailures }]
          : []),
        ...(graph === undefined
          ? []
          : [
              { name: "dependency-graph.json" as const, payload: graph },
              { name: "modules.json" as const, payload: payload.files.map((file) => ({ path: file.path, language: file.language, ...(file.fileKind === undefined ? {} : { fileKind: file.fileKind }) })) },
              { name: "symbols.json" as const, payload: symbols },
              ...(knowledge === undefined ? [] : [{ name: "knowledge.json" as const, payload: knowledge }]),
              ...(semantic === undefined ? [] : [{ name: "semantic.json" as const, payload: semantic }]),
              ...(controlFlow === undefined ? [] : [{ name: "control-flow.json" as const, payload: controlFlow }]),
              ...(dataFlow === undefined ? [] : [{ name: "data-flow.json" as const, payload: dataFlow }]),
            ]),
      ],
      metadata: {
        projectId: payload.projectId,
        analysisRunId: payload.analysisRunId,
        projectName: payload.projectName,
      },
    });

      await this.adapter.write(projection);
      return projection;
    })();

    this.activeProjections.add(task);
    try {
      return await task;
    } finally {
      this.activeProjections.delete(task);
    }
  }

  public async stop(): Promise<void> {
    this.status = "stopped";
    if (this.activeProjections.size > 0) {
      await Promise.allSettled([...this.activeProjections]);
    }
    await this.adapter.drain();
  }
}

function matchesRun(payload: RunScopedPayload, projectId: string, analysisRunId: string | undefined): boolean {
  return payload.projectId === projectId && (analysisRunId === undefined || payload.analysisRunId === analysisRunId);
}

function latestPayload<Payload extends RunScopedPayload>(
  records: readonly StorageRecord[],
  schema: z.ZodType<Payload>,
  projectId: string,
  analysisRunId: string | undefined,
): Payload | undefined {
  if (records.length === 0) {
    return undefined;
  }

  const candidates: { payload: Payload; updatedAt: number; index: number }[] = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index]!;
    const parsed = schema.safeParse(record.payload);
    if (!parsed.success) {
      throw new LegacyExodusError({
        code: "DISCOVERY_RECORD_INVALID",
        message: `Stored ${record.type} record is invalid.`,
        metadata: { issues: parsed.error.issues, recordId: record.id },
      });
    }
    if (matchesRun(parsed.data, projectId, analysisRunId)) {
      candidates.push({ payload: parsed.data, updatedAt: record.updatedAt.getTime(), index });
    }
  }

  candidates.sort((left, right) => left.updatedAt - right.updatedAt || left.index - right.index);
  return candidates.at(-1)?.payload;
}
