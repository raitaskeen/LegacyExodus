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
        moduleSpecifier: null, sourceSymbolName: name === "signIn" ? "login" : null,
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
        moduleSpecifier: null, sourceSymbolName: "login",
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
});
