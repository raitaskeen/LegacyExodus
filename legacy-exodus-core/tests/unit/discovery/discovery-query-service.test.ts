import { beforeEach, describe, expect, it } from "bun:test";

import { DiscoveryQueryService } from "@discovery/discovery-query-service";
import { MemoryStorageProvider } from "@storage/adapters/memory-storage";
import { StorageManager } from "@storage/storage-manager";
import { createStorageRecord } from "@storage/storage-record";

describe("DiscoveryQueryService", () => {
  let storage: StorageManager;
  let service: DiscoveryQueryService;

  const projectId = "12345678-1234-4234-8234-123456789012";
  const runId1 = "aaaa1111-2222-4333-8444-555566667777";
  const runId2 = "bbbb1111-2222-4333-8444-555566667777";

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
});
