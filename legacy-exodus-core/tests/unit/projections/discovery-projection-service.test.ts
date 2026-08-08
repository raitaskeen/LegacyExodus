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
      });
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });
});
