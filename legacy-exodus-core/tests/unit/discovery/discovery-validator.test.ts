import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { DiscoveryValidator } from "@discovery/discovery-validator";

describe("DiscoveryValidator", () => {
  const validator = new DiscoveryValidator();

  it("returns MANIFEST_MISSING when .discovery directory or manifest does not exist", async () => {
    const testDir = join(tmpdir(), `test-validator-missing-${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    try {
      const result = await validator.validate({ projectPath: testDir });
      expect(result.valid).toBe(false);
      expect(result.status).toBe("MANIFEST_MISSING");
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("returns MANIFEST_INVALID when manifest is malformed JSON or invalid schema", async () => {
    const testDir = join(tmpdir(), `test-validator-invalid-${Date.now()}`);
    const discoveryDir = join(testDir, ".discovery");
    await mkdir(discoveryDir, { recursive: true });

    try {
      await writeFile(join(discoveryDir, "manifest.json"), "{ broken json", "utf8");
      const result = await validator.validate({ projectPath: testDir });
      expect(result.valid).toBe(false);
      expect(result.status).toBe("MANIFEST_INVALID");
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("returns SCHEMA_MISMATCH when manifest schemaVersion does not match expected", async () => {
    const testDir = join(tmpdir(), `test-validator-schema-${Date.now()}`);
    const discoveryDir = join(testDir, ".discovery");
    await mkdir(discoveryDir, { recursive: true });

    const manifest = {
      schemaVersion: 999,
      repository: { name: "test", path: testDir },
      engine: { packageVersion: "0.1.0", commitSha: "abc", bunVersion: "bun-v1.3.0" },
      analysis: { projectId: "00000000-0000-4000-8000-000000000001", generatedAt: new Date().toISOString() },
      requiredArtifacts: [],
      artifacts: {},
    };

    try {
      await writeFile(join(discoveryDir, "manifest.json"), JSON.stringify(manifest), "utf8");
      const result = await validator.validate({ projectPath: testDir, expectedSchemaVersion: 1 });
      expect(result.valid).toBe(false);
      expect(result.status).toBe("SCHEMA_MISMATCH");
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("returns PATH_MISMATCH when repository path in manifest differs from target path", async () => {
    const testDir = join(tmpdir(), `test-validator-path-${Date.now()}`);
    const discoveryDir = join(testDir, ".discovery");
    await mkdir(discoveryDir, { recursive: true });

    const manifest = {
      schemaVersion: 1,
      repository: { name: "test", path: "/some/different/path" },
      engine: { packageVersion: "0.1.0", commitSha: "abc", bunVersion: "bun-v1.3.0" },
      analysis: { projectId: "00000000-0000-4000-8000-000000000001", generatedAt: new Date().toISOString() },
      requiredArtifacts: [],
      artifacts: {},
    };

    try {
      await writeFile(join(discoveryDir, "manifest.json"), JSON.stringify(manifest), "utf8");
      const result = await validator.validate({ projectPath: testDir });
      expect(result.valid).toBe(false);
      expect(result.status).toBe("PATH_MISMATCH");
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("validates valid manifest and verifies artifact SHA256 checksums", async () => {
    const testDir = join(tmpdir(), `test-validator-valid-${Date.now()}`);
    const discoveryDir = join(testDir, ".discovery");
    await mkdir(discoveryDir, { recursive: true });

    const filesContent = JSON.stringify([{ id: "f1", path: "src/index.ts" }]);
    const filesSha = createHash("sha256").update(filesContent).digest("hex");
    await writeFile(join(discoveryDir, "files.json"), filesContent, "utf8");

    const manifest = {
      schemaVersion: 1,
      repository: { name: "test", path: testDir },
      engine: { packageVersion: "0.1.0", commitSha: "abc", bunVersion: "bun-v1.3.0" },
      analysis: { projectId: "00000000-0000-4000-8000-000000000001", generatedAt: new Date().toISOString() },
      requiredArtifacts: ["files.json"],
      artifacts: {
        "files.json": { sha256: filesSha, bytes: filesContent.length },
      },
    };

    try {
      await writeFile(join(discoveryDir, "manifest.json"), JSON.stringify(manifest), "utf8");
      const result = await validator.validate({ projectPath: testDir });
      expect(result.valid).toBe(true);
      expect(result.status).toBe("VALID");
      expect(result.manifest?.repository.name).toBe("test");
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("returns CHECKSUM_MISMATCH when an artifact content does not match recorded sha256", async () => {
    const testDir = join(tmpdir(), `test-validator-checksum-${Date.now()}`);
    const discoveryDir = join(testDir, ".discovery");
    await mkdir(discoveryDir, { recursive: true });

    const filesContent = JSON.stringify([{ id: "f1", path: "src/index.ts" }]);
    await writeFile(join(discoveryDir, "files.json"), filesContent, "utf8");

    const manifest = {
      schemaVersion: 1,
      repository: { name: "test", path: testDir },
      engine: { packageVersion: "0.1.0", commitSha: "abc", bunVersion: "bun-v1.3.0" },
      analysis: { projectId: "00000000-0000-4000-8000-000000000001", generatedAt: new Date().toISOString() },
      requiredArtifacts: ["files.json"],
      artifacts: {
        "files.json": { sha256: "0000000000000000000000000000000000000000000000000000000000000000", bytes: 10 },
      },
    };

    try {
      await writeFile(join(discoveryDir, "manifest.json"), JSON.stringify(manifest), "utf8");
      const result = await validator.validate({ projectPath: testDir });
      expect(result.valid).toBe(false);
      expect(result.status).toBe("CHECKSUM_MISMATCH");
      expect(result.failedArtifact).toBe("files.json");
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });
});
