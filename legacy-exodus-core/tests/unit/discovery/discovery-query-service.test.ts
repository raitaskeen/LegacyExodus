import { beforeEach, describe, expect, it } from "bun:test";

import {
  DiscoveryQueryService,
  type AnalysisRunPayload,
} from "@discovery/discovery-query-service";
import { LegacyExodusError } from "@shared/errors";
import { MemoryStorageProvider } from "@storage/adapters/memory-storage";
import { StorageManager } from "@storage/storage-manager";
import {
  createStorageRecord,
  validateStorageRecord,
  type SerializedPayload,
  type StorageRecord,
} from "@storage/storage-record";
import type { StorageQueryCriteria } from "@storage/storage-provider";

class StreamingOnlyMemoryStorageProvider extends MemoryStorageProvider {
  public override async findScoped<Payload extends SerializedPayload>(
    _criteria: StorageQueryCriteria,
  ): Promise<StorageRecord<Payload>[]> {
    throw new Error("materializing findScoped query is forbidden");
  }
}

describe("DiscoveryQueryService", () => {
  let storage: StorageManager;
  let service: DiscoveryQueryService;

  const projectId = "12345678-1234-4234-8234-123456789012";
  const otherProjectId = "87654321-4321-4321-8321-210987654321";
  const runId1 = "aaaa1111-2222-4333-8444-555566667777";
  const runId2 = "bbbb1111-2222-4333-8444-555566667777";
  const runId3 = "cccc1111-2222-4333-8444-555566667777";
  const startedAt = "2026-01-01T00:00:00.000Z";

  function atTime<Payload extends SerializedPayload>(
    record: StorageRecord<Payload>,
    updatedAt: number,
  ): StorageRecord<Payload> {
    return validateStorageRecord({
      ...record,
      createdAt: new Date(updatedAt),
      updatedAt: new Date(updatedAt),
    });
  }

  function analysisRunRecord(
    targetProjectId: string,
    analysisRunId: string,
    status: "created" | "running" | "completed" | "failed",
    updatedAt: number,
  ): StorageRecord<AnalysisRunPayload> {
    return atTime(createStorageRecord<AnalysisRunPayload>("analysis-run", {
      projectId: targetProjectId,
      analysisRunId,
      status,
      startedAt,
      ...(status === "completed" ? { completedAt: "2026-01-01T00:01:00.000Z" } : {}),
      ...(status === "failed" ? { error: "analysis failed" } : {}),
    }), updatedAt);
  }

  function discoveryRecord(
    targetProjectId: string,
    analysisRunId: string,
    updatedAt: number,
  ): StorageRecord {
    return atTime(createStorageRecord("project-discovery", {
      projectId: targetProjectId,
      analysisRunId,
      projectName: "legacy-app",
      projectPath: "/repo/legacy-app",
      files: [],
      dependencies: [],
      frameworks: [],
      languages: ["typescript"],
      discoveredAt: startedAt,
    }), updatedAt);
  }

  async function expectInvalidRecord(
    operation: Promise<unknown>,
    recordId: string,
  ): Promise<void> {
    let caught: unknown;
    try {
      await operation;
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(LegacyExodusError);
    expect((caught as LegacyExodusError).code).toBe("DISCOVERY_RECORD_INVALID");
    expect((caught as LegacyExodusError).metadata.recordId).toBe(recordId);
  }

  beforeEach(() => {
    storage = new StorageManager(new MemoryStorageProvider());
    service = new DiscoveryQueryService(storage);
  });

  it("queries project discovery matching runId and projectId", async () => {
    const record1 = createStorageRecord("project-discovery", {
      projectId,
      analysisRunId: runId1,
      projectName: "legacy-app",
      projectPath: "/repo/legacy-app",
      files: [{ id: "f1", path: "src/index.ts", language: "typescript", size: 100 }],
      dependencies: [{ name: "express", version: "4.18.2", kind: "production" as const }],
      frameworks: [{ name: "express", evidence: "package.json" }],
      languages: ["typescript"],
      discoveredAt: new Date().toISOString(),
    });

    const record2 = createStorageRecord("project-discovery", {
      projectId,
      analysisRunId: runId2,
      projectName: "legacy-app",
      projectPath: "/repo/legacy-app",
      files: [
        { id: "f1", path: "src/index.ts", language: "typescript", size: 100 },
        { id: "f2", path: "src/app.ts", language: "typescript", size: 200 },
      ],
      dependencies: [],
      frameworks: [],
      languages: ["typescript"],
      discoveredAt: new Date().toISOString(),
    });

    await storage.save(record1);
    await storage.save(record2);

    const run1Discovery = await service.getProjectDiscovery(projectId, runId1);
    expect(run1Discovery).not.toBeNull();
    expect(run1Discovery?.analysisRunId).toBe(runId1);
    expect(run1Discovery?.files).toHaveLength(1);

    const run2Discovery = await service.getProjectDiscovery(projectId, runId2);
    expect(run2Discovery).not.toBeNull();
    expect(run2Discovery?.analysisRunId).toBe(runId2);
    expect(run2Discovery?.files).toHaveLength(2);

    const files = await service.getDiscoveredFiles(projectId, runId1);
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("src/index.ts");
  });

  it("queries symbols specifically for a target file path", async () => {
    const symbolRecord1 = createStorageRecord("symbol-table", {
      projectId,
      analysisRunId: runId1,
      fileId: "f1",
      path: "src/index.ts",
      symbolCount: 1,
      classes: 0,
      functions: 1,
      imports: 0,
      exports: 1,
      symbols: [
        {
          id: "s1",
          kind: "function",
          name: "main",
          filePath: "src/index.ts",
          language: "typescript",
          exported: true,
          defaultExport: false,
          async: false,
          anonymous: false,
          visibility: "public",
          parameters: [],
        },
      ],
    });

    const symbolRecord2 = createStorageRecord("symbol-table", {
      projectId,
      analysisRunId: runId1,
      fileId: "f2",
      path: "src/utils.ts",
      symbolCount: 1,
      classes: 0,
      functions: 1,
      imports: 0,
      exports: 1,
      symbols: [
        {
          id: "s2",
          kind: "function",
          name: "helper",
          filePath: "src/utils.ts",
          language: "typescript",
          exported: true,
          defaultExport: false,
          async: false,
          anonymous: false,
          visibility: "public",
          parameters: [],
        },
      ],
    });

    await storage.save(symbolRecord1);
    await storage.save(symbolRecord2);

    const indexSymbols = await service.getSymbolsForFile(projectId, "src/index.ts", runId1);
    expect(indexSymbols).toHaveLength(1);
    expect(indexSymbols[0]?.name).toBe("main");

    const utilsSymbols = await service.getSymbolsForFile(projectId, "src/utils.ts", runId1);
    expect(utilsSymbols).toHaveLength(1);
    expect(utilsSymbols[0]?.name).toBe("helper");

    const missingSymbols = await service.getSymbolsForFile(projectId, "src/nonexistent.ts", runId1);
    expect(missingSymbols).toHaveLength(0);
  });

  it("queries dependency graph and knowledge graph by runId", async () => {
    const depRecord = createStorageRecord("dependency-graph", {
      projectId,
      analysisRunId: runId1,
      nodes: [{ id: "n1", filePath: "src/index.ts", symbolId: "s1" }],
      edges: [],
      cycles: [],
    });

    const kgRecord = createStorageRecord("knowledge-graph", {
      projectId,
      analysisRunId: runId1,
      nodes: [{ id: "k1", kind: "module", name: "index", filePath: "src/index.ts" }],
      edges: [],
    });

    await storage.save(depRecord);
    await storage.save(kgRecord);

    const depGraph = await service.getDependencyGraph(projectId, runId1);
    expect(depGraph).not.toBeNull();
    expect(depGraph?.nodes).toHaveLength(1);

    const kg = await service.getKnowledgeGraph(projectId, runId1);
    expect(kg).not.toBeNull();
    expect(kg?.nodes).toHaveLength(1);
  });

  it("uses the streaming boundary for analysis-run lookup and latest completed selection", async () => {
    const provider = new StreamingOnlyMemoryStorageProvider();
    const streamingStorage = new StorageManager(provider);
    const streamingService = new DiscoveryQueryService(streamingStorage);
    const completed = analysisRunRecord(projectId, runId1, "completed", 1_000);
    await streamingStorage.save(completed);

    expect(await streamingService.getAnalysisRun(projectId, runId1)).toEqual(completed.payload);
    expect(await streamingService.getLatestCompletedRunId(projectId)).toBe(runId1);
  });

  it("validates malformed analysis-run history before selecting a newer valid record", async () => {
    const malformed = atTime(createStorageRecord("analysis-run", {
      projectId,
      analysisRunId: runId1,
      status: "invalid-status",
      startedAt,
    }), 1_000);
    await storage.save(malformed);
    await storage.save(analysisRunRecord(projectId, runId1, "completed", 2_000));

    await expectInvalidRecord(service.getAnalysisRun(projectId, runId1), malformed.id);
  });

  it("validates malformed analysis-run history after an older valid record", async () => {
    await storage.save(analysisRunRecord(projectId, runId1, "completed", 1_000));
    const malformed = atTime(createStorageRecord("analysis-run", {
      projectId,
      analysisRunId: runId1,
      startedAt,
    }), 2_000);
    await storage.save(malformed);

    await expectInvalidRecord(service.getAnalysisRun(projectId, runId1), malformed.id);
  });

  it("falls back to project discovery only when zero analysis-run records exist", async () => {
    await storage.save(discoveryRecord(projectId, runId1, 1_000));

    expect(await service.getLatestCompletedRunId(projectId)).toBe(runId1);
  });

  for (const status of ["running", "failed"] as const) {
    it(`returns null instead of discovery fallback when a ${status} analysis run exists`, async () => {
      await storage.save(discoveryRecord(projectId, runId1, 1_000));
      await storage.save(analysisRunRecord(projectId, runId2, status, 2_000));

      expect(await service.getLatestCompletedRunId(projectId)).toBeNull();
    });

    it(`keeps an older completed run when a newer ${status} run exists`, async () => {
      await storage.save(analysisRunRecord(projectId, runId1, "completed", 1_000));
      await storage.save(analysisRunRecord(projectId, runId2, status, 2_000));

      expect(await service.getLatestCompletedRunId(projectId)).toBe(runId1);
    });
  }

  it("skips malformed analysis-run records without falling back to discovery", async () => {
    await storage.save(discoveryRecord(projectId, runId1, 1_000));
    await storage.save(atTime(createStorageRecord("analysis-run", {
      projectId,
      analysisRunId: runId2,
      status: "invalid-status",
      startedAt,
    }), 2_000));

    expect(await service.getLatestCompletedRunId(projectId)).toBeNull();
  });

  it("selects the newest completed run by updatedAt", async () => {
    await storage.save(analysisRunRecord(projectId, runId1, "completed", 1_000));
    await storage.save(analysisRunRecord(projectId, runId2, "completed", 3_000));
    await storage.save(analysisRunRecord(projectId, runId3, "completed", 2_000));

    expect(await service.getLatestCompletedRunId(projectId)).toBe(runId2);
  });

  it("uses later stream position to break equal-updatedAt completed-run ties", async () => {
    await storage.save(analysisRunRecord(projectId, runId1, "completed", 1_000));
    await storage.save(analysisRunRecord(projectId, runId2, "completed", 1_000));

    expect(await service.getLatestCompletedRunId(projectId)).toBe(runId2);
  });

  it("validates every project-discovery fallback record before selecting the latest", async () => {
    const malformed = atTime(createStorageRecord("project-discovery", {
      projectId,
      analysisRunId: runId1,
      projectName: "legacy-app",
    }), 1_000);
    await storage.save(malformed);
    await storage.save(discoveryRecord(projectId, runId2, 2_000));

    await expectInvalidRecord(service.getLatestCompletedRunId(projectId), malformed.id);
  });

  it("keeps latest completed-run selection isolated by project", async () => {
    await storage.save(analysisRunRecord(projectId, runId1, "completed", 1_000));
    await storage.save(analysisRunRecord(otherProjectId, runId2, "completed", 2_000));

    expect(await service.getLatestCompletedRunId(projectId)).toBe(runId1);
    expect(await service.getLatestCompletedRunId(otherProjectId)).toBe(runId2);
  });
});
