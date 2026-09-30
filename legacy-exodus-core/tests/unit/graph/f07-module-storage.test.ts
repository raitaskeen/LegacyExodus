import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dependencyGraphPayloadSchema } from "@contracts/discovery-storage";
import { validateDependencyGraph, validateCurrentDependencyGraph, DeterministicDependencyGraphBuilder } from "@graph/index";
import { sourceAnchorSchema } from "@symbols/module-reference-contracts";
import { JavaScriptParser } from "@parser/index";
import { JavaScriptSymbolExtractor, validateSymbolTable } from "@symbols/index";
import { DiscoveryQueryService } from "@discovery/discovery-query-service";
import { createStorageRecord, StorageManager, MemoryStorageProvider, DiscoveryProjectionService, FileDiscoveryProjectionAdapter } from "@storage/index";
import { SqliteStorageProvider, SQLITE_SCHEMA_VERSION } from "@storage/adapters/sqlite-storage";

async function currentGraph() {
  const files = [{ id: "a", path: "src/a.ts", language: "typescript", size: 13 }, { id: "b", path: "src/b.ts", language: "typescript", size: 0 }];
  const tables = await Promise.all(files.map(async (file, index) => new JavaScriptSymbolExtractor().extract((await new JavaScriptParser().parse({ file, source: index === 0 ? 'import "./b";' : "" })).result)));
  return new DeterministicDependencyGraphBuilder().build(tables, files);
}

describe("F07 current and historical persistence contracts", () => {
  test("T8 historical absence remains absent and cannot validate as current", () => {
    const historical = { nodes: [], edges: [], cycles: [] };
    const graph = validateDependencyGraph(historical);
    expect(graph).not.toHaveProperty("moduleGraph");
    expect(() => validateCurrentDependencyGraph(historical)).toThrow();
    const payload = dependencyGraphPayloadSchema.parse({ projectId: "00000000-0000-4000-8000-000000000001", ...historical });
    expect(payload).not.toHaveProperty("moduleGraph");
    expect(validateCurrentDependencyGraph({ ...historical, moduleGraph: { contract: "f07-import-relations-v1", edges: [] } }).moduleGraph.edges).toEqual([]);
  });

  test("T8 rejects present malformed layers at graph and persisted payload boundaries", async () => {
    const graph = await currentGraph();
    const edge = graph.moduleGraph.edges[0]!;
    const invalidLayers: readonly unknown[] = [
      undefined, null, {}, { contract: "unknown", edges: [] }, { contract: "f07-import-relations-v1" },
      { contract: "f07-import-relations-v1", edges: null },
      { contract: "f07-import-relations-v1", edges: [{ ...edge, sourceAnchor: undefined }] },
      { contract: "f07-import-relations-v1", edges: [{ ...edge, sourceAnchor: { kind: "offset", start: 9, end: 1 } }] },
      { contract: "f07-import-relations-v1", edges: [{ ...edge, targetExportSymbolId: "fake" }] },
      { contract: "f07-import-relations-v1", edges: [], nodes: [] },
    ];
    for (const moduleGraph of invalidLayers) {
      expect(() => validateDependencyGraph({ ...graph, moduleGraph })).toThrow();
      expect(() => validateCurrentDependencyGraph({ ...graph, moduleGraph })).toThrow();
      expect(dependencyGraphPayloadSchema.safeParse({ projectId: "00000000-0000-4000-8000-000000000001", ...graph, moduleGraph }).success).toBe(false);
    }
  });

  test("T8 current layer survives validation and deeply immutable graph output", async () => {
    const graph = await currentGraph();
    expect(validateCurrentDependencyGraph(JSON.parse(JSON.stringify(graph)))).toEqual(graph);
    for (const value of [graph, graph.moduleGraph, graph.moduleGraph.edges, graph.moduleGraph.edges[0], graph.moduleGraph.edges[0]?.sourceAnchor]) expect(Object.isFrozen(value)).toBe(true);
    expect(() => validateDependencyGraph({ ...graph, edges: [{ id: "binding-without-target", sourceFilePath: "a", targetFilePath: "b", importSymbolId: "i", moduleSpecifier: "./b" }] })).toThrow();
  });

  test("T13 anchors reject invalid coordinates and transient references reject invalid association", async () => {
    for (const anchor of [{ kind: "offset", start: -1, end: 1 }, { kind: "offset", start: 0.5, end: 1 }, { kind: "offset", start: 3, end: 2 }, { kind: "location", start: { line: 2, column: 0 }, end: { line: 1, column: 0 } }]) expect(sourceAnchorSchema.safeParse(anchor).success).toBe(false);
    const table = new JavaScriptSymbolExtractor().extract((await new JavaScriptParser().parse({ file: { id: "a", path: "a.ts", language: "typescript", size: 13 }, source: 'import "./b";' })).result);
    expect(() => validateSymbolTable({ ...table, moduleReferences: [] })).toThrow();
    expect(() => validateSymbolTable({ ...table, moduleReferences: [{ ...table.moduleReferences?.[0], importSymbolIds: ["unknown"] }] })).toThrow();
    const { moduleReferences, ...historical } = table;
    expect(validateSymbolTable(historical)).not.toHaveProperty("moduleReferences");
  });

  for (const driver of ["memory", "sqlite"] as const) {
    test(`T8 ${driver} storage, query, and projection retain full module layer`, async () => {
      const projectPath = await mkdtemp(join(tmpdir(), "lx-f07-storage-"));
      const storage = new StorageManager(driver === "memory" ? new MemoryStorageProvider() : new SqliteStorageProvider({ inMemory: true }));
      const service = new DiscoveryProjectionService(storage, new FileDiscoveryProjectionAdapter());
      try {
        const projectId = "00000000-0000-4000-8000-000000000001";
        const analysisRunId = "00000000-0000-4000-8000-000000000002";
        const graph = await currentGraph();
        const discovery = createStorageRecord("project-discovery", { projectId, analysisRunId, projectName: "f07", projectPath, files: [], dependencies: [], frameworks: [], languages: [], discoveredAt: "2026-09-30T00:00:00.000Z" });
        await storage.saveBatch([discovery, createStorageRecord("dependency-graph", { projectId, analysisRunId, ...graph })]);
        const queried = await new DiscoveryQueryService(storage).getDependencyGraph(projectId, analysisRunId);
        expect(validateCurrentDependencyGraph(queried).moduleGraph).toEqual(graph.moduleGraph);
        await service.project(discovery.id);
        const projected = JSON.parse(await readFile(join(projectPath, ".discovery", "dependency-graph.json"), "utf8"));
        expect(projected.moduleGraph).toEqual(graph.moduleGraph);
        expect(projected.edges).toEqual(graph.edges);
        expect(SQLITE_SCHEMA_VERSION).toBe(1);
      } finally {
        await service.stop();
        await storage.close();
        await rm(projectPath, { recursive: true, force: true });
      }
    });
  }
});
