import { z } from "zod";

import { createDiscoveryProjection, type DiscoveryProjection } from "@contracts/discovery-projection";
import { LegacyExodusError } from "@shared/errors";
import type { StorageRecord } from "@storage/storage-record";
import type { StorageManager } from "@storage/storage-manager";

import { FileDiscoveryProjectionAdapter } from "./file-discovery-projection";

const discoveryStoragePayloadSchema = z.object({
  projectId: z.string().uuid(),
  analysisRunId: z.string().uuid().optional(),
  projectName: z.string().min(1),
  projectPath: z.string().min(1),
  files: z.array(z.object({ id: z.string().min(1), path: z.string().min(1), language: z.string().min(1), fileKind: z.string().min(1).optional(), size: z.number().nonnegative() })),
  dependencies: z.array(z.object({ name: z.string().min(1), version: z.string().min(1), kind: z.enum(["production", "development"]) })),
  frameworks: z.array(z.object({ name: z.string().min(1), evidence: z.string().min(1) })),
  languages: z.array(z.string().min(1)),
  enumerationFailures: z.array(z.object({
    path: z.string().min(1),
    kind: z.enum(["directory-read", "entry-stat"]),
    code: z.string().min(1),
  })).optional(),
  discoveredAt: z.string().datetime(),
});

const dependencyGraphStoragePayloadSchema = z.object({
  projectId: z.string().uuid(),
  analysisRunId: z.string().uuid().optional(),
  nodes: z.array(z.object({ id: z.string(), filePath: z.string(), symbolId: z.string() })),
  edges: z.array(z.object({ id: z.string(), sourceFilePath: z.string(), targetFilePath: z.string(), importSymbolId: z.string(), targetExportSymbolId: z.string(), moduleSpecifier: z.string() })),
  cycles: z.array(z.array(z.string())),
});

const symbolTableStoragePayloadSchema = z.object({
  projectId: z.string().uuid(),
  analysisRunId: z.string().uuid().optional(),
  path: z.string(),
  symbols: z.array(z.object({
    id: z.string(), kind: z.string(), name: z.string(), filePath: z.string(), exported: z.boolean(), defaultExport: z.boolean(),
    moduleSpecifier: z.string().nullable(), sourceSymbolName: z.string().nullable(),
  })),
});

const knowledgeGraphStoragePayloadSchema = z.object({
  projectId: z.string().uuid(),
  analysisRunId: z.string().uuid().optional(),
  nodes: z.array(z.object({ id: z.string(), kind: z.string(), name: z.string(), filePath: z.string() })),
  edges: z.array(z.object({ id: z.string(), from: z.string(), to: z.string(), relationship: z.string() })),
});

const semanticAnalysisStoragePayloadSchema = z.object({
  projectId: z.string().uuid(),
  analysisRunId: z.string().uuid().optional(),
  calls: z.array(z.unknown()), references: z.array(z.unknown()), scopes: z.array(z.unknown()), deadCode: z.array(z.unknown()),
  unusedImports: z.array(z.unknown()), unusedExports: z.array(z.unknown()), entryPoints: z.array(z.unknown()),
  routes: z.array(z.unknown()), middlewareChains: z.array(z.unknown()),
});
const controlFlowStoragePayloadSchema = z.object({ projectId: z.string().uuid(), analysisRunId: z.string().uuid().optional(), graphs: z.array(z.unknown()) });
const dataFlowStoragePayloadSchema = z.object({ projectId: z.string().uuid(), analysisRunId: z.string().uuid().optional(), graphs: z.array(z.unknown()) });

type RunScopedPayload = { readonly projectId: string; readonly analysisRunId?: string };

export class DiscoveryProjectionService {
  public constructor(
    private readonly storage: StorageManager,
    private readonly adapter: FileDiscoveryProjectionAdapter,
  ) {}

  public async project(recordId: string): Promise<DiscoveryProjection> {
    const record = await this.storage.findById(recordId);
    if (record === null || record.type !== "project-discovery") {
      throw new LegacyExodusError({ code: "DISCOVERY_RECORD_NOT_FOUND", message: "Stored discovery record was not found.", metadata: { recordId } });
    }

    const discovery = discoveryStoragePayloadSchema.safeParse(record.payload);
    if (!discovery.success) {
      throw new LegacyExodusError({ code: "DISCOVERY_RECORD_INVALID", message: "Stored discovery record is invalid.", metadata: { issues: discovery.error.issues, recordId } });
    }

    const payload = discovery.data;
    const [graphRecords, symbolRecords, knowledgeRecords, semanticRecords, controlFlowRecords, dataFlowRecords] = await Promise.all([
      this.storage.findAll("dependency-graph"),
      this.storage.findAll("symbol-table"),
      this.storage.findAll("knowledge-graph"),
      this.storage.findAll("semantic-analysis"),
      this.storage.findAll("control-flow-analysis"),
      this.storage.findAll("data-flow-analysis"),
    ]);
    const graph = latestPayload(graphRecords, dependencyGraphStoragePayloadSchema, payload.projectId, payload.analysisRunId);
    const knowledge = latestPayload(knowledgeRecords, knowledgeGraphStoragePayloadSchema, payload.projectId, payload.analysisRunId);
    const semantic = latestPayload(semanticRecords, semanticAnalysisStoragePayloadSchema, payload.projectId, payload.analysisRunId);
    const controlFlow = latestPayload(controlFlowRecords, controlFlowStoragePayloadSchema, payload.projectId, payload.analysisRunId);
    const dataFlow = latestPayload(dataFlowRecords, dataFlowStoragePayloadSchema, payload.projectId, payload.analysisRunId);
    const symbols = symbolRecords
      .flatMap((candidate) => {
        const parsed = symbolTableStoragePayloadSchema.safeParse(candidate.payload);
        return parsed.success && matchesRun(parsed.data, payload.projectId, payload.analysisRunId) ? parsed.data.symbols : [];
      })
      .sort((left, right) => `${left.filePath}:${left.id}`.localeCompare(`${right.filePath}:${right.id}`));

    const projection = createDiscoveryProjection({
      projectPath: payload.projectPath,
      artifacts: [
        { name: "project.json", payload: { name: payload.projectName, path: payload.projectPath, languages: payload.languages } },
        { name: "files.json", payload: payload.files },
        { name: "dependencies.json", payload: payload.dependencies },
        { name: "frameworks.json", payload: payload.frameworks },
        {
          name: "summary.json",
          payload: {
            projectName: payload.projectName,
            fileCount: payload.files.length,
            dependencyCount: payload.dependencies.length,
            frameworkCount: payload.frameworks.length,
            languages: payload.languages,
            enumerationFailureCount: (payload.enumerationFailures ?? []).length,
            discoveryComplete: (payload.enumerationFailures ?? []).length === 0,
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
  const candidates = records.flatMap((record, index) => {
    const parsed = schema.safeParse(record.payload);
    return parsed.success && matchesRun(parsed.data, projectId, analysisRunId)
      ? [{ payload: parsed.data, updatedAt: record.updatedAt.getTime(), index }]
      : [];
  });
  candidates.sort((left, right) => left.updatedAt - right.updatedAt || left.index - right.index);
  return candidates.at(-1)?.payload;
}
