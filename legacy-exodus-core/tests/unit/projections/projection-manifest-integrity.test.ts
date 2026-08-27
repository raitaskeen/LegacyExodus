import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createDiscoveryProjection } from "@contracts/discovery-projection";
import { DiscoveryValidator } from "@discovery/discovery-validator";
import {
  createStorageRecord,
  DiscoveryProjectionService,
  FileDiscoveryProjectionAdapter,
  MemoryStorageProvider,
  StorageManager,
} from "@storage/index";

describe("F-002: Discovery Projection Manifest Artifact Contract Integrity", () => {
  const validator = new DiscoveryValidator();
  const adapter = new FileDiscoveryProjectionAdapter();

  // ─── Case A: Full Projection ──────────────────────────────────────────────
  it("Case A: claims only and all successfully produced artifacts in full projection runs", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "f002-full-"));
    try {
      const projection = createDiscoveryProjection({
        projectPath,
        artifacts: [
          { name: "project.json", payload: { name: "full-app", languages: ["javascript"] } },
          { name: "files.json", payload: [{ path: "src/index.js" }] },
          { name: "dependencies.json", payload: [] },
          { name: "frameworks.json", payload: [] },
          { name: "summary.json", payload: { fileCount: 1 } },
          { name: "dependency-graph.json", payload: { nodes: [], edges: [] } },
          { name: "modules.json", payload: [{ path: "src/index.js", language: "javascript" }] },
          { name: "symbols.json", payload: [] },
          { name: "semantic.json", payload: { calls: [], references: [] } },
          { name: "control-flow.json", payload: { graphs: [] } },
          { name: "data-flow.json", payload: { graphs: [] } },
        ],
      });

      await adapter.write(projection);

      const manifestContent = JSON.parse(await readFile(join(projectPath, ".discovery", "manifest.json"), "utf8"));
      const artifactKeys = Object.keys(manifestContent.artifacts).sort();

      expect(manifestContent.requiredArtifacts).toEqual(artifactKeys);
      expect(manifestContent.requiredArtifacts).toEqual([
        "control-flow.json",
        "data-flow.json",
        "dependencies.json",
        "dependency-graph.json",
        "files.json",
        "frameworks.json",
        "modules.json",
        "project.json",
        "semantic.json",
        "summary.json",
        "symbols.json",
      ]);

      const validation = await validator.validate({ projectPath });
      expect(validation.valid).toBe(true);
      expect(validation.status).toBe("VALID");
    } finally {
      await rm(projectPath, { recursive: true, force: true });
    }
  });

  // ─── Case B: Partial / Discovery-Only Projection ──────────────────────────
  it("Case B: claims only the subset of artifacts produced by partial/discovery-only runs", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "f002-partial-"));
    try {
      const projection = createDiscoveryProjection({
        projectPath,
        artifacts: [
          { name: "project.json", payload: { name: "discovery-only", languages: ["typescript"] } },
          { name: "files.json", payload: [{ path: "src/app.ts" }] },
          { name: "dependencies.json", payload: [] },
          { name: "frameworks.json", payload: [] },
          { name: "summary.json", payload: { fileCount: 1 } },
        ],
      });

      await adapter.write(projection);

      const manifestContent = JSON.parse(await readFile(join(projectPath, ".discovery", "manifest.json"), "utf8"));
      const artifactKeys = Object.keys(manifestContent.artifacts).sort();

      expect(manifestContent.requiredArtifacts).toEqual(artifactKeys);
      expect(manifestContent.requiredArtifacts).toEqual([
        "dependencies.json",
        "files.json",
        "frameworks.json",
        "project.json",
        "summary.json",
      ]);
      expect(manifestContent.requiredArtifacts).not.toContain("symbols.json");
      expect(manifestContent.requiredArtifacts).not.toContain("control-flow.json");
      expect(manifestContent.requiredArtifacts).not.toContain("data-flow.json");

      const validation = await validator.validate({ projectPath });
      expect(validation.valid).toBe(true);
      expect(validation.status).toBe("VALID");
    } finally {
      await rm(projectPath, { recursive: true, force: true });
    }
  });

  // ─── Case C: Storage-Driven Projection Service Integration ────────────────
  it("Case C: integrates with DiscoveryProjectionService to produce truthful manifest for discovery records", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "f002-service-"));
    const storage = new StorageManager(new MemoryStorageProvider());
    const service = new DiscoveryProjectionService(storage, adapter);

    const record = createStorageRecord("project-discovery", {
      projectId: "00000000-0000-4000-8000-000000000090",
      projectName: "service-test",
      projectPath,
      files: [{ id: "file-1", path: "src/main.js", language: "javascript", size: 50 }],
      dependencies: [],
      frameworks: [],
      languages: ["javascript"],
      discoveredAt: "2026-08-27T00:00:00.000Z",
    });

    try {
      await storage.save(record);
      await service.project(record.id);

      const manifestContent = JSON.parse(await readFile(join(projectPath, ".discovery", "manifest.json"), "utf8"));
      expect(manifestContent.requiredArtifacts).toEqual([
        "dependencies.json",
        "files.json",
        "frameworks.json",
        "project.json",
        "summary.json",
      ]);

      const validation = await validator.validate({ projectPath });
      expect(validation.valid).toBe(true);
      expect(validation.status).toBe("VALID");
    } finally {
      await rm(projectPath, { recursive: true, force: true });
    }
  });

  // ─── Case D: Tampered / Missing Artifact Validation Failure ───────────────
  it("Case D: correctly fails validation when an artifact in manifest is deleted or altered", async () => {
    const projectPath1 = await mkdtemp(join(tmpdir(), "f002-tamper-1-"));
    const projectPath2 = await mkdtemp(join(tmpdir(), "f002-tamper-2-"));
    try {
      const projection1 = createDiscoveryProjection({
        projectPath: projectPath1,
        artifacts: [
          { name: "project.json", payload: { name: "tamper-1", languages: ["javascript"] } },
          { name: "files.json", payload: [{ path: "src/index.js" }] },
        ],
      });
      await adapter.write(projection1);

      // 1. Alter files.json content -> CHECKSUM_MISMATCH
      await writeFile(join(projectPath1, ".discovery", "files.json"), "[]", "utf8");
      const checksumResult = await validator.validate({ projectPath: projectPath1 });
      expect(checksumResult.valid).toBe(false);
      expect(checksumResult.status).toBe("CHECKSUM_MISMATCH");
      expect(checksumResult.failedArtifact).toBe("files.json");

      const projection2 = createDiscoveryProjection({
        projectPath: projectPath2,
        artifacts: [
          { name: "project.json", payload: { name: "tamper-2", languages: ["javascript"] } },
          { name: "summary.json", payload: { fileCount: 1 } },
        ],
      });
      await adapter.write(projection2);

      // 2. Delete summary.json -> ARTIFACT_MISSING
      await unlink(join(projectPath2, ".discovery", "summary.json"));
      const missingResult = await validator.validate({ projectPath: projectPath2 });
      expect(missingResult.valid).toBe(false);
      expect(missingResult.status).toBe("ARTIFACT_MISSING");
      expect(missingResult.failedArtifact).toBe("summary.json");
    } finally {
      await rm(projectPath1, { recursive: true, force: true });
      await rm(projectPath2, { recursive: true, force: true });
    }
  });

  // ─── Case E: Preserves P0.3 Canonical control-flow.json Contract ──────────
  it("Case E: preserves control-flow.json as canonical and never references cfg.json in manifest", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "f002-p03-"));
    try {
      const projection = createDiscoveryProjection({
        projectPath,
        artifacts: [
          { name: "project.json", payload: { name: "flow-app", languages: ["javascript"] } },
          { name: "control-flow.json", payload: { graphs: [{ id: "cfg-1", functionName: "handler" }] } },
        ],
      });

      await adapter.write(projection);

      const manifestContent = JSON.parse(await readFile(join(projectPath, ".discovery", "manifest.json"), "utf8"));
      expect(manifestContent.requiredArtifacts).toContain("control-flow.json");
      expect(manifestContent.requiredArtifacts).not.toContain("cfg.json");
      expect(manifestContent.artifacts["control-flow.json"]).toBeDefined();
      expect(manifestContent.artifacts["cfg.json"]).toBeUndefined();
    } finally {
      await rm(projectPath, { recursive: true, force: true });
    }
  });

  // ─── Case F: Determinism Across Repeated Runs ─────────────────────────────
  it("Case F: produces deterministic, identically sorted requiredArtifacts across repeated invocations", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "f002-det-"));
    try {
      const projection = createDiscoveryProjection({
        projectPath,
        artifacts: [
          { name: "summary.json", payload: { count: 2 } },
          { name: "project.json", payload: { name: "det", languages: [] } },
          { name: "files.json", payload: [] },
          { name: "data-flow.json", payload: {} },
          { name: "dependencies.json", payload: [] },
        ],
      });

      await adapter.write(projection);
      const manifest1 = JSON.parse(await readFile(join(projectPath, ".discovery", "manifest.json"), "utf8"));

      await adapter.write(projection);
      const manifest2 = JSON.parse(await readFile(join(projectPath, ".discovery", "manifest.json"), "utf8"));

      expect(manifest1.requiredArtifacts).toEqual(manifest2.requiredArtifacts);
      expect(manifest1.requiredArtifacts).toEqual([
        "data-flow.json",
        "dependencies.json",
        "files.json",
        "project.json",
        "summary.json",
      ]);
    } finally {
      await rm(projectPath, { recursive: true, force: true });
    }
  });
});
