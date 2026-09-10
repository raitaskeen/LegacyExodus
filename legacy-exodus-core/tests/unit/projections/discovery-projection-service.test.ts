import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, test } from "bun:test";

import {
  createStorageRecord,
  DiscoveryProjectionService,
  FileDiscoveryProjectionAdapter,
  MemoryStorageProvider,
  StorageManager,
} from "@storage/index";

describe("DiscoveryProjectionService", () => {
  test("projects a stored discovery record through the storage boundary", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-stored-discovery-"));
    const storage = new StorageManager(new MemoryStorageProvider());
    const record = createStorageRecord("project-discovery", {
      projectId: "00000000-0000-4000-8000-000000000040",
      projectName: "library-system",
      projectPath,
      files: [{ id: "file-1", path: "src/index.js", language: "javascript", size: 20 }],
      dependencies: [{ name: "express", version: "4.0.0", kind: "production" }],
      frameworks: [{ name: "express", evidence: "package.json dependency" }],
      languages: ["javascript"],
      discoveredAt: "2026-08-08T00:00:00.000Z",
    });
    const service = new DiscoveryProjectionService(storage, new FileDiscoveryProjectionAdapter());

    try {
      await storage.save(record);
      const projection = await service.project(record.id);

      expect(projection.artifacts).toHaveLength(5);
      expect(JSON.parse(await readFile(join(projectPath, ".discovery", "summary.json"), "utf8"))).toEqual({
        projectName: "library-system",
        fileCount: 1,
        dependencyCount: 1,
        frameworkCount: 1,
        languages: ["javascript"],
        enumerationFailureCount: 0,
        discoveryComplete: true,
      });
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });

  test("projects graph, knowledge, and symbols from only the active analysis run", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-run-scoped-projection-"));
    const storage = new StorageManager(new MemoryStorageProvider());
    const projectId = "00000000-0000-4000-8000-000000000050";
    const staleRunId = "00000000-0000-4000-8000-000000000051";
    const activeRunId = "00000000-0000-4000-8000-000000000052";
    const discovery = createStorageRecord("project-discovery", {
      projectId,
      analysisRunId: activeRunId,
      projectName: "library-system",
      projectPath,
      files: [{ id: "file-1", path: "src/index.js", language: "javascript", size: 20 }],
      dependencies: [], frameworks: [], languages: ["javascript"], discoveredAt: "2026-08-08T00:00:00.000Z",
    });
    const graph = (analysisRunId: string, id: string) => createStorageRecord("dependency-graph", {
      projectId, analysisRunId, nodes: [], edges: [], cycles: [[id, id]],
    });
    const symbols = (analysisRunId: string, name: string) => createStorageRecord("symbol-table", {
      projectId, analysisRunId, path: "src/index.js", symbols: [{
        id: name, kind: "export", name, filePath: "src/index.js", exported: true, defaultExport: false,
        language: "javascript", async: false, anonymous: false, visibility: "public", parameters: [],
        ...(name === "signIn" ? { sourceSymbolName: "login" } : {}),
      }],
    });
    const knowledge = (analysisRunId: string, id: string) => createStorageRecord("knowledge-graph", {
      projectId, analysisRunId, nodes: [{ id, kind: "symbol", name: id, filePath: "src/index.js" }], edges: [],
    });

    try {
      await storage.save(discovery);
      await storage.save(graph(staleRunId, "stale"));
      await storage.save(graph(activeRunId, "active"));
      await storage.save(symbols(staleRunId, "stale"));
      await storage.save(symbols(activeRunId, "signIn"));
      await storage.save(knowledge(staleRunId, "stale"));
      await storage.save(knowledge(activeRunId, "active"));
      await new DiscoveryProjectionService(storage, new FileDiscoveryProjectionAdapter()).project(discovery.id);

      expect(JSON.parse(await readFile(join(projectPath, ".discovery", "symbols.json"), "utf8"))).toEqual([{
        id: "signIn", kind: "export", name: "signIn", filePath: "src/index.js", exported: true, defaultExport: false,
        language: "javascript", async: false, anonymous: false, visibility: "public", parameters: [],
        sourceSymbolName: "login",
      }]);
      expect(JSON.parse(await readFile(join(projectPath, ".discovery", "knowledge.json"), "utf8"))).toEqual({
        projectId, analysisRunId: activeRunId, nodes: [{ id: "active", kind: "symbol", name: "active", filePath: "src/index.js" }], edges: [],
      });
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });

  test("projects enumeration-failures.json when enumeration failures are recorded in discovery record", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-fail-projection-"));
    const storage = new StorageManager(new MemoryStorageProvider());
    const record = createStorageRecord("project-discovery", {
      projectId: "00000000-0000-4000-8000-000000000070",
      projectName: "partial-project",
      projectPath,
      files: [{ id: "file-1", path: "src/index.js", language: "javascript", size: 20 }],
      dependencies: [],
      frameworks: [],
      languages: ["javascript"],
      enumerationFailures: [
        { path: "secret_dir", kind: "directory-read", code: "EACCES" },
      ],
      discoveredAt: "2026-08-08T00:00:00.000Z",
    });
    const service = new DiscoveryProjectionService(storage, new FileDiscoveryProjectionAdapter());

    try {
      await storage.save(record);
      const projection = await service.project(record.id);

      expect(projection.artifacts.some((a) => a.name === "enumeration-failures.json")).toBe(true);
      expect(JSON.parse(await readFile(join(projectPath, ".discovery", "summary.json"), "utf8"))).toEqual({
        projectName: "partial-project",
        fileCount: 1,
        dependencyCount: 0,
        frameworkCount: 0,
        languages: ["javascript"],
        enumerationFailureCount: 1,
        discoveryComplete: false,
      });
      expect(JSON.parse(await readFile(join(projectPath, ".discovery", "enumeration-failures.json"), "utf8"))).toEqual([
        { path: "secret_dir", kind: "directory-read", code: "EACCES" },
      ]);
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });

  test("P0.3: projects canonical control-flow.json without emitting duplicate cfg.json", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-flow-projection-"));
    const storage = new StorageManager(new MemoryStorageProvider());
    const projectId = "00000000-0000-4000-8000-000000000080";
    const analysisRunId = "00000000-0000-4000-8000-000000000081";
    const discovery = createStorageRecord("project-discovery", {
      projectId,
      analysisRunId,
      projectName: "flow-project",
      projectPath,
      files: [{ id: "file-1", path: "src/index.js", language: "javascript", size: 20 }],
      dependencies: [],
      frameworks: [],
      languages: ["javascript"],
      discoveredAt: "2026-08-08T00:00:00.000Z",
    });
    const graph = createStorageRecord("dependency-graph", {
      projectId,
      analysisRunId,
      nodes: [],
      edges: [],
      cycles: [],
    });
    const controlFlow = createStorageRecord("control-flow-analysis", {
      projectId,
      analysisRunId,
      graphs: [
        {
          id: "cfg-1",
          filePath: "src/index.js",
          scopeName: "login",
          state: "RESOLVED",
          entryBlockId: "entry",
          exitBlockId: "exit",
          blocks: [
            { id: "entry", statements: [], predecessorIds: [], successorIds: ["exit"] },
            { id: "exit", statements: [], predecessorIds: ["entry"], successorIds: [] },
          ],
          edges: [{ id: "edge-1", fromBlockId: "entry", toBlockId: "exit", kind: "next" }],
          dominators: [
            { blockId: "entry" },
            { blockId: "exit", immediateDominatorId: "entry" },
          ],
          loops: [],
          unreachableBlockIds: [],
          deadCodeNodeIds: [],
        },
      ],
    });
    const service = new DiscoveryProjectionService(storage, new FileDiscoveryProjectionAdapter());

    try {
      await storage.save(discovery);
      await storage.save(graph);
      await storage.save(controlFlow);
      const projection = await service.project(discovery.id);

      expect(projection.artifacts.some((a) => a.name === "control-flow.json")).toBe(true);
      expect(projection.artifacts.some((a) => a.name === "cfg.json")).toBe(false);

      const writtenControlFlow = JSON.parse(
        await readFile(join(projectPath, ".discovery", "control-flow.json"), "utf8"),
      ) as { readonly projectId: string; readonly graphs: readonly { readonly scopeName: string }[] };

      expect(writtenControlFlow.projectId).toBe(projectId);
      expect(writtenControlFlow.graphs).toHaveLength(1);
      expect(writtenControlFlow.graphs[0]!.scopeName).toBe("login");
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });
});
