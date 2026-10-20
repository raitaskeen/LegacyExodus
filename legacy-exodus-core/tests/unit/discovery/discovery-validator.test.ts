import { describe, expect, it } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { DiscoveryValidator, computeWorkspaceDigest } from "@discovery/discovery-validator";
import type { DiscoveryManifest } from "@discovery/discovery-validator";
import { FileScanner } from "@discovery/file-scanner";

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

  // ─── SEC-02: Path Traversal Hardening Regression Tests ────────────────────

  it("SEC-02 Test 1: Valid root-level artifact succeeds", async () => {
    const testDir = join(tmpdir(), `sec02-test-valid-root-${Date.now()}`);
    const discoveryDir = join(testDir, ".discovery");
    await mkdir(discoveryDir, { recursive: true });

    const content = JSON.stringify({ count: 1 });
    const sha256 = createHash("sha256").update(content).digest("hex");
    await writeFile(join(discoveryDir, "files.json"), content, "utf8");

    const manifest = {
      schemaVersion: 1,
      repository: { name: "test", path: testDir },
      engine: { packageVersion: "0.1.0", commitSha: "abc", bunVersion: "bun-v1.3.0" },
      analysis: { projectId: "00000000-0000-4000-8000-000000000001", generatedAt: new Date().toISOString() },
      requiredArtifacts: ["files.json"],
      artifacts: { "files.json": { sha256, bytes: content.length } },
    };

    try {
      await writeFile(join(discoveryDir, "manifest.json"), JSON.stringify(manifest), "utf8");
      const result = await validator.validate({ projectPath: testDir });
      expect(result.valid).toBe(true);
      expect(result.status).toBe("VALID");
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("SEC-02 Test 2: Valid nested artifact path succeeds", async () => {
    const testDir = join(tmpdir(), `sec02-test-valid-nested-${Date.now()}`);
    const discoveryDir = join(testDir, ".discovery");
    const nestedDir = join(discoveryDir, "artifacts", "v1");
    await mkdir(nestedDir, { recursive: true });

    const content = JSON.stringify({ nested: true });
    const sha256 = createHash("sha256").update(content).digest("hex");
    await writeFile(join(nestedDir, "state.json"), content, "utf8");

    const manifest = {
      schemaVersion: 1,
      repository: { name: "test", path: testDir },
      engine: { packageVersion: "0.1.0", commitSha: "abc", bunVersion: "bun-v1.3.0" },
      analysis: { projectId: "00000000-0000-4000-8000-000000000001", generatedAt: new Date().toISOString() },
      requiredArtifacts: ["artifacts/v1/state.json"],
      artifacts: { "artifacts/v1/state.json": { sha256, bytes: content.length } },
    };

    try {
      await writeFile(join(discoveryDir, "manifest.json"), JSON.stringify(manifest), "utf8");
      const result = await validator.validate({ projectPath: testDir });
      expect(result.valid).toBe(true);
      expect(result.status).toBe("VALID");
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("SEC-02 Test 3: Rejects basic '../outside.json' traversal before disk read", async () => {
    const testDir = join(tmpdir(), `sec02-test-basic-traversal-${Date.now()}`);
    const discoveryDir = join(testDir, ".discovery");
    await mkdir(discoveryDir, { recursive: true });

    // Target file outside discovery dir
    const outsideFile = join(testDir, "outside.json");
    await writeFile(outsideFile, '{"secret": 123}', "utf8");

    const manifest = {
      schemaVersion: 1,
      repository: { name: "test", path: testDir },
      engine: { packageVersion: "0.1.0", commitSha: "abc", bunVersion: "bun-v1.3.0" },
      analysis: { projectId: "00000000-0000-4000-8000-000000000001", generatedAt: new Date().toISOString() },
      requiredArtifacts: ["../outside.json"],
      artifacts: {
        "../outside.json": { sha256: "0000000000000000000000000000000000000000000000000000000000000000", bytes: 15 },
      },
    };

    try {
      await writeFile(join(discoveryDir, "manifest.json"), JSON.stringify(manifest), "utf8");
      const result = await validator.validate({ projectPath: testDir });
      expect(result.valid).toBe(false);
      expect(result.status).toBe("MANIFEST_INVALID");
      expect(result.reason).toContain("attempts traversal outside discovery directory");
      expect(result.failedArtifact).toBe("../outside.json");
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("SEC-02 Test 4: Rejects multi-level '../../outside.json' traversal", async () => {
    const testDir = join(tmpdir(), `sec02-test-multi-traversal-${Date.now()}`);
    const discoveryDir = join(testDir, ".discovery");
    await mkdir(discoveryDir, { recursive: true });

    const manifest = {
      schemaVersion: 1,
      repository: { name: "test", path: testDir },
      engine: { packageVersion: "0.1.0", commitSha: "abc", bunVersion: "bun-v1.3.0" },
      analysis: { projectId: "00000000-0000-4000-8000-000000000001", generatedAt: new Date().toISOString() },
      requiredArtifacts: ["../../outside.json"],
      artifacts: {
        "../../outside.json": { sha256: "0000000000000000000000000000000000000000000000000000000000000000", bytes: 10 },
      },
    };

    try {
      await writeFile(join(discoveryDir, "manifest.json"), JSON.stringify(manifest), "utf8");
      const result = await validator.validate({ projectPath: testDir });
      expect(result.valid).toBe(false);
      expect(result.status).toBe("MANIFEST_INVALID");
      expect(result.reason).toContain("attempts traversal outside discovery directory");
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("SEC-02 Test 5: Rejects traversal disguised behind valid directory ('nested/../../outside.json')", async () => {
    const testDir = join(tmpdir(), `sec02-test-nested-traversal-${Date.now()}`);
    const discoveryDir = join(testDir, ".discovery");
    await mkdir(discoveryDir, { recursive: true });

    const manifest = {
      schemaVersion: 1,
      repository: { name: "test", path: testDir },
      engine: { packageVersion: "0.1.0", commitSha: "abc", bunVersion: "bun-v1.3.0" },
      analysis: { projectId: "00000000-0000-4000-8000-000000000001", generatedAt: new Date().toISOString() },
      requiredArtifacts: ["nested/../../outside.json"],
      artifacts: {
        "nested/../../outside.json": { sha256: "0000000000000000000000000000000000000000000000000000000000000000", bytes: 10 },
      },
    };

    try {
      await writeFile(join(discoveryDir, "manifest.json"), JSON.stringify(manifest), "utf8");
      const result = await validator.validate({ projectPath: testDir });
      expect(result.valid).toBe(false);
      expect(result.status).toBe("MANIFEST_INVALID");
      expect(result.reason).toContain("attempts traversal outside discovery directory");
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("SEC-02 Test 6: Rejects Windows backslash traversal ('..\\outside.json' and 'nested\\..\\..\\outside.json')", async () => {
    const testDir = join(tmpdir(), `sec02-test-backslash-traversal-${Date.now()}`);
    const discoveryDir = join(testDir, ".discovery");
    await mkdir(discoveryDir, { recursive: true });

    const manifest = {
      schemaVersion: 1,
      repository: { name: "test", path: testDir },
      engine: { packageVersion: "0.1.0", commitSha: "abc", bunVersion: "bun-v1.3.0" },
      analysis: { projectId: "00000000-0000-4000-8000-000000000001", generatedAt: new Date().toISOString() },
      requiredArtifacts: ["..\\outside.json", "nested\\..\\..\\outside.json"],
      artifacts: {
        "..\\outside.json": { sha256: "0000000000000000000000000000000000000000000000000000000000000000", bytes: 10 },
        "nested\\..\\..\\outside.json": { sha256: "0000000000000000000000000000000000000000000000000000000000000000", bytes: 10 },
      },
    };

    try {
      await writeFile(join(discoveryDir, "manifest.json"), JSON.stringify(manifest), "utf8");
      const result = await validator.validate({ projectPath: testDir });
      expect(result.valid).toBe(false);
      expect(result.status).toBe("MANIFEST_INVALID");
      expect(result.reason).toContain("attempts traversal outside discovery directory");
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("SEC-02 Test 7: Rejects absolute path references", async () => {
    const testDir = join(tmpdir(), `sec02-test-absolute-path-${Date.now()}`);
    const discoveryDir = join(testDir, ".discovery");
    await mkdir(discoveryDir, { recursive: true });

    const absolutePath = process.platform === "win32" ? "C:\\Windows\\system.ini" : "/etc/passwd";

    const manifest = {
      schemaVersion: 1,
      repository: { name: "test", path: testDir },
      engine: { packageVersion: "0.1.0", commitSha: "abc", bunVersion: "bun-v1.3.0" },
      analysis: { projectId: "00000000-0000-4000-8000-000000000001", generatedAt: new Date().toISOString() },
      requiredArtifacts: [absolutePath],
      artifacts: {
        [absolutePath]: { sha256: "0000000000000000000000000000000000000000000000000000000000000000", bytes: 10 },
      },
    };

    try {
      await writeFile(join(discoveryDir, "manifest.json"), JSON.stringify(manifest), "utf8");
      const result = await validator.validate({ projectPath: testDir });
      expect(result.valid).toBe(false);
      expect(result.status).toBe("MANIFEST_INVALID");
      expect(result.reason).toContain("attempts traversal outside discovery directory");
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("SEC-02 Test 8: Rejects Windows drive-letter paths (e.g. 'C:outside.json' or 'D:\\file.json')", async () => {
    const testDir = join(tmpdir(), `sec02-test-win-drive-${Date.now()}`);
    const discoveryDir = join(testDir, ".discovery");
    await mkdir(discoveryDir, { recursive: true });

    const manifest = {
      schemaVersion: 1,
      repository: { name: "test", path: testDir },
      engine: { packageVersion: "0.1.0", commitSha: "abc", bunVersion: "bun-v1.3.0" },
      analysis: { projectId: "00000000-0000-4000-8000-000000000001", generatedAt: new Date().toISOString() },
      requiredArtifacts: ["C:outside.json"],
      artifacts: {
        "C:outside.json": { sha256: "0000000000000000000000000000000000000000000000000000000000000000", bytes: 10 },
      },
    };

    try {
      await writeFile(join(discoveryDir, "manifest.json"), JSON.stringify(manifest), "utf8");
      const result = await validator.validate({ projectPath: testDir });
      expect(result.valid).toBe(false);
      expect(result.status).toBe("MANIFEST_INVALID");
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("SEC-02 Test 9: Rejects UNC paths (e.g. '\\\\server\\share\\outside.json')", async () => {
    const testDir = join(tmpdir(), `sec02-test-unc-${Date.now()}`);
    const discoveryDir = join(testDir, ".discovery");
    await mkdir(discoveryDir, { recursive: true });

    const manifest = {
      schemaVersion: 1,
      repository: { name: "test", path: testDir },
      engine: { packageVersion: "0.1.0", commitSha: "abc", bunVersion: "bun-v1.3.0" },
      analysis: { projectId: "00000000-0000-4000-8000-000000000001", generatedAt: new Date().toISOString() },
      requiredArtifacts: ["\\\\server\\share\\outside.json"],
      artifacts: {
        "\\\\server\\share\\outside.json": { sha256: "0000000000000000000000000000000000000000000000000000000000000000", bytes: 10 },
      },
    };

    try {
      await writeFile(join(discoveryDir, "manifest.json"), JSON.stringify(manifest), "utf8");
      const result = await validator.validate({ projectPath: testDir });
      expect(result.valid).toBe(false);
      expect(result.status).toBe("MANIFEST_INVALID");
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("SEC-02 Test 10: Prevents prefix-collision bypass (e.g. '../.discovery-evil/outside.json')", async () => {
    const baseDir = join(tmpdir(), `sec02-prefix-base-${Date.now()}`);
    const projectDir = join(baseDir, "project");
    const discoveryDir = join(projectDir, ".discovery");
    const evilDiscoveryDir = join(projectDir, ".discovery-evil");
    await mkdir(discoveryDir, { recursive: true });
    await mkdir(evilDiscoveryDir, { recursive: true });

    const evilFile = join(evilDiscoveryDir, "outside.json");
    await writeFile(evilFile, '{"evil": true}', "utf8");

    const manifest = {
      schemaVersion: 1,
      repository: { name: "test", path: projectDir },
      engine: { packageVersion: "0.1.0", commitSha: "abc", bunVersion: "bun-v1.3.0" },
      analysis: { projectId: "00000000-0000-4000-8000-000000000001", generatedAt: new Date().toISOString() },
      requiredArtifacts: ["../.discovery-evil/outside.json"],
      artifacts: {
        "../.discovery-evil/outside.json": { sha256: "0000000000000000000000000000000000000000000000000000000000000000", bytes: 14 },
      },
    };

    try {
      await writeFile(join(discoveryDir, "manifest.json"), JSON.stringify(manifest), "utf8");
      const result = await validator.validate({ projectPath: projectDir });
      expect(result.valid).toBe(false);
      expect(result.status).toBe("MANIFEST_INVALID");
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("SEC-02 Test 11: Rejects symbolic links within .discovery pointing outside", async () => {
    const testDir = join(tmpdir(), `sec02-test-symlink-${Date.now()}`);
    const discoveryDir = join(testDir, ".discovery");
    await mkdir(discoveryDir, { recursive: true });

    const outsideTarget = join(testDir, "outside-secret.json");
    await writeFile(outsideTarget, '{"secret": 456}', "utf8");

    // Attempt to create symlink (handle platform symlink permissions gracefully)
    const symlinkPath = join(discoveryDir, "files.json");
    try {
      const { symlink } = await import("node:fs/promises");
      await symlink(outsideTarget, symlinkPath, "file");
    } catch {
      // If OS / Windows non-elevated user disallows symlink creation, skip test gracefully
      return;
    }

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
      expect(result.status).toBe("MANIFEST_INVALID");
      expect(result.reason).toContain("is a symbolic link");
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("SEC-02 Test 12: Rejects symlinked parent/ancestor directories resolving outside discovery directory", async () => {
    const testDir = join(tmpdir(), `sec02-test-parent-symlink-${Date.now()}`);
    const discoveryDir = join(testDir, ".discovery");
    const outsideDir = join(testDir, "outside-dir");
    await mkdir(discoveryDir, { recursive: true });
    await mkdir(outsideDir, { recursive: true });

    const outsideFile = join(outsideDir, "secret.json");
    await writeFile(outsideFile, '{"secret": 789}', "utf8");

    const symlinkDir = join(discoveryDir, "linked-dir");
    try {
      const { symlink } = await import("node:fs/promises");
      await symlink(outsideDir, symlinkDir, "dir");
    } catch {
      // If OS / Windows non-elevated user disallows directory symlink creation, skip test gracefully
      return;
    }

    const manifest = {
      schemaVersion: 1,
      repository: { name: "test", path: testDir },
      engine: { packageVersion: "0.1.0", commitSha: "abc", bunVersion: "bun-v1.3.0" },
      analysis: { projectId: "00000000-0000-4000-8000-000000000001", generatedAt: new Date().toISOString() },
      requiredArtifacts: ["linked-dir/secret.json"],
      artifacts: {
        "linked-dir/secret.json": { sha256: "0000000000000000000000000000000000000000000000000000000000000000", bytes: 10 },
      },
    };

    try {
      await writeFile(join(discoveryDir, "manifest.json"), JSON.stringify(manifest), "utf8");
      const result = await validator.validate({ projectPath: testDir });
      expect(result.valid).toBe(false);
      expect(result.status).toBe("MANIFEST_INVALID");
      expect(result.reason).toContain("physically resolves outside discovery directory");
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  // ─── REUSE-01: Workspace Freshness Tests ──────────────────────────────────

  it("REUSE-01: computeWorkspaceDigest produces deterministic SHA-256 and detects in-place file modifications", async () => {
    const testDir = join(tmpdir(), `test-digest-${Date.now()}-${Math.random()}`);
    await mkdir(join(testDir, "src"), { recursive: true });
    await writeFile(join(testDir, "src", "a.ts"), "const a = 1;\n", "utf8");
    await writeFile(join(testDir, "src", "b.ts"), "const b = 2;\n", "utf8");

    try {
      const digest1 = await computeWorkspaceDigest(testDir);
      const digest2 = await computeWorkspaceDigest(testDir);
      expect(digest1).toBe(digest2);
      expect(digest1).toMatch(/^[0-9a-f]{64}$/);

      // In-place modification of same byte size
      await writeFile(join(testDir, "src", "a.ts"), "const a = 9;\n", "utf8");
      const digest3 = await computeWorkspaceDigest(testDir);
      expect(digest3).not.toBe(digest1);
      expect(digest3).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("REUSE-01: validate with verifyFreshness returns VALID for unchanged workspace", async () => {
    const testDir = join(tmpdir(), `test-fresh-${Date.now()}-${Math.random()}`);
    const discoveryDir = join(testDir, ".discovery");
    await mkdir(join(testDir, "src"), { recursive: true });
    await mkdir(discoveryDir, { recursive: true });

    const fileAContent = "export const x = 10;\n";
    await writeFile(join(testDir, "src", "index.ts"), fileAContent, "utf8");

    const filesArtifact = [
      {
        id: createHash("sha256").update("src/index.ts").digest("hex"),
        path: "src/index.ts",
        language: "typescript",
        fileKind: "source",
        size: Buffer.byteLength(fileAContent, "utf8"),
      },
    ];
    const filesJson = JSON.stringify(filesArtifact, null, 2);
    await writeFile(join(discoveryDir, "files.json"), filesJson, "utf8");

    const sourceDigest = await computeWorkspaceDigest(testDir);
    const filesSha = createHash("sha256").update(filesJson).digest("hex");

    const manifest = {
      schemaVersion: 1,
      repository: { name: "test-fresh", path: testDir, sourceDigest },
      engine: { packageVersion: "0.1.0", commitSha: "abc", bunVersion: "bun-v1.3.0" },
      analysis: { projectId: "00000000-0000-4000-8000-000000000001", generatedAt: new Date().toISOString() },
      requiredArtifacts: ["files.json"],
      artifacts: {
        "files.json": { sha256: filesSha, bytes: Buffer.byteLength(filesJson, "utf8") },
      },
    };
    await writeFile(join(discoveryDir, "manifest.json"), JSON.stringify(manifest), "utf8");

    try {
      const result = await validator.validate({ projectPath: testDir, verifyFreshness: true });
      expect(result.valid).toBe(true);
      expect(result.status).toBe("VALID");
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("REUSE-01: validate with verifyFreshness returns SNAPSHOT_STALE when source file content is modified", async () => {
    const testDir = join(tmpdir(), `test-stale-mod-${Date.now()}-${Math.random()}`);
    const discoveryDir = join(testDir, ".discovery");
    await mkdir(join(testDir, "src"), { recursive: true });
    await mkdir(discoveryDir, { recursive: true });

    const fileAContent = "export const x = 10;\n";
    await writeFile(join(testDir, "src", "index.ts"), fileAContent, "utf8");

    const filesArtifact = [
      {
        id: createHash("sha256").update("src/index.ts").digest("hex"),
        path: "src/index.ts",
        language: "typescript",
        fileKind: "source",
        size: Buffer.byteLength(fileAContent, "utf8"),
      },
    ];
    const filesJson = JSON.stringify(filesArtifact, null, 2);
    await writeFile(join(discoveryDir, "files.json"), filesJson, "utf8");

    const sourceDigest = await computeWorkspaceDigest(testDir);
    const filesSha = createHash("sha256").update(filesJson).digest("hex");

    const manifest = {
      schemaVersion: 1,
      repository: { name: "test-stale", path: testDir, sourceDigest },
      engine: { packageVersion: "0.1.0", commitSha: "abc", bunVersion: "bun-v1.3.0" },
      analysis: { projectId: "00000000-0000-4000-8000-000000000001", generatedAt: new Date().toISOString() },
      requiredArtifacts: ["files.json"],
      artifacts: {
        "files.json": { sha256: filesSha, bytes: Buffer.byteLength(filesJson, "utf8") },
      },
    };
    await writeFile(join(discoveryDir, "manifest.json"), JSON.stringify(manifest), "utf8");

    try {
      // Modify source file
      await writeFile(join(testDir, "src", "index.ts"), "export const x = 99;\n", "utf8");

      const result = await validator.validate({ projectPath: testDir, verifyFreshness: true });
      expect(result.valid).toBe(false);
      expect(result.status).toBe("SNAPSHOT_STALE");
      expect(result.reason).toContain("digest mismatch");
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("REUSE-01: validate with verifyFreshness returns SNAPSHOT_STALE when new file is added or removed", async () => {
    const testDir = join(tmpdir(), `test-stale-add-${Date.now()}-${Math.random()}`);
    const discoveryDir = join(testDir, ".discovery");
    await mkdir(join(testDir, "src"), { recursive: true });
    await mkdir(discoveryDir, { recursive: true });

    const fileAContent = "export const x = 10;\n";
    await writeFile(join(testDir, "src", "index.ts"), fileAContent, "utf8");

    const filesArtifact = [
      {
        id: createHash("sha256").update("src/index.ts").digest("hex"),
        path: "src/index.ts",
        language: "typescript",
        fileKind: "source",
        size: Buffer.byteLength(fileAContent, "utf8"),
      },
    ];
    const filesJson = JSON.stringify(filesArtifact, null, 2);
    await writeFile(join(discoveryDir, "files.json"), filesJson, "utf8");

    const sourceDigest = await computeWorkspaceDigest(testDir);
    const filesSha = createHash("sha256").update(filesJson).digest("hex");

    const manifest = {
      schemaVersion: 1,
      repository: { name: "test-stale", path: testDir, sourceDigest },
      engine: { packageVersion: "0.1.0", commitSha: "abc", bunVersion: "bun-v1.3.0" },
      analysis: { projectId: "00000000-0000-4000-8000-000000000001", generatedAt: new Date().toISOString() },
      requiredArtifacts: ["files.json"],
      artifacts: {
        "files.json": { sha256: filesSha, bytes: Buffer.byteLength(filesJson, "utf8") },
      },
    };
    await writeFile(join(discoveryDir, "manifest.json"), JSON.stringify(manifest), "utf8");

    try {
      // Add a new file to the workspace
      await writeFile(join(testDir, "src", "extra.ts"), "export const extra = true;\n", "utf8");

      const result = await validator.validate({ projectPath: testDir, verifyFreshness: true });
      expect(result.valid).toBe(false);
      expect(result.status).toBe("SNAPSHOT_STALE");
      expect(result.reason).toContain("Workspace file count changed");
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("REUSE-03: returns populated validatedArtifacts containing exact verified bytes on valid snapshot", async () => {
    const testDir = join(tmpdir(), `test-validator-reuse03-${Date.now()}`);
    const discoveryDir = join(testDir, ".discovery");
    await mkdir(discoveryDir, { recursive: true });

    const fileContent = JSON.stringify({ name: "reuse03-test", version: "1.0.0" }, null, 2);
    await writeFile(join(discoveryDir, "project.json"), fileContent, "utf8");

    const sha256 = createHash("sha256").update(Buffer.from(fileContent, "utf8")).digest("hex");
    const manifest = {
      schemaVersion: 1,
      repository: { name: "reuse03-test", path: testDir },
      engine: { packageVersion: "0.1.0", commitSha: "abc", bunVersion: "bun-v1.3.0" },
      analysis: { projectId: "00000000-0000-4000-8000-000000000001", generatedAt: new Date().toISOString() },
      requiredArtifacts: ["project.json"],
      artifacts: {
        "project.json": { sha256, bytes: Buffer.byteLength(fileContent, "utf8") },
      },
    };
    await writeFile(join(discoveryDir, "manifest.json"), JSON.stringify(manifest), "utf8");

    try {
      const result = await validator.validate({ projectPath: testDir });
      expect(result.valid).toBe(true);
      expect(result.status).toBe("VALID");
      expect(result.validatedArtifacts).toBeDefined();
      expect(result.validatedArtifacts?.get("project.json")).toBe(fileContent);

      // Verify that the in-memory string has the exact digest that was verified
      const inMemorySha = createHash("sha256")
        .update(Buffer.from(result.validatedArtifacts!.get("project.json")!, "utf8"))
        .digest("hex");
      expect(inMemorySha).toBe(sha256);
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  // ─── SEC-03: .discovery Root Symlink Boundary Tests ───────────────────────

  it("SEC-03 Test 1: Rejects .discovery when it is a symlink/junction pointing outside project", async () => {
    const baseDir = join(tmpdir(), `sec03-test-outside-${Date.now()}-${Math.random()}`);
    const projectDir = join(baseDir, "project");
    const outsideDir = join(baseDir, "outside");
    await mkdir(projectDir, { recursive: true });
    await mkdir(outsideDir, { recursive: true });

    const symlinkPath = join(projectDir, ".discovery");
    try {
      const { symlink } = await import("node:fs/promises");
      const linkType = process.platform === "win32" ? "junction" : "dir";
      await symlink(outsideDir, symlinkPath, linkType);
    } catch {
      await rm(baseDir, { recursive: true, force: true });
      return;
    }

    const manifest = {
      schemaVersion: 1,
      repository: { name: "test", path: projectDir },
      engine: { packageVersion: "0.1.0", commitSha: "abc", bunVersion: "bun-v1.3.0" },
      analysis: { projectId: "00000000-0000-4000-8000-000000000001", generatedAt: new Date().toISOString() },
      requiredArtifacts: [],
      artifacts: {},
    };
    await writeFile(join(outsideDir, "manifest.json"), JSON.stringify(manifest), "utf8");

    try {
      const result = await validator.validate({ projectPath: projectDir });
      expect(result.valid).toBe(false);
      expect(result.status).toBe("MANIFEST_INVALID");
      expect(result.reason).toContain("is a symbolic link");
    } finally {
      try {
        const { unlink } = await import("node:fs/promises");
        await unlink(symlinkPath);
      } catch {}
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("SEC-03 Test 2: Rejects .discovery when it is a symlink/junction pointing inside project", async () => {
    const projectDir = join(tmpdir(), `sec03-test-inside-${Date.now()}-${Math.random()}`);
    const insideDir = join(projectDir, "inside-disc");
    await mkdir(insideDir, { recursive: true });

    const symlinkPath = join(projectDir, ".discovery");
    try {
      const { symlink } = await import("node:fs/promises");
      const linkType = process.platform === "win32" ? "junction" : "dir";
      await symlink(insideDir, symlinkPath, linkType);
    } catch {
      await rm(projectDir, { recursive: true, force: true });
      return;
    }

    const manifest = {
      schemaVersion: 1,
      repository: { name: "test", path: projectDir },
      engine: { packageVersion: "0.1.0", commitSha: "abc", bunVersion: "bun-v1.3.0" },
      analysis: { projectId: "00000000-0000-4000-8000-000000000001", generatedAt: new Date().toISOString() },
      requiredArtifacts: [],
      artifacts: {},
    };
    await writeFile(join(insideDir, "manifest.json"), JSON.stringify(manifest), "utf8");

    try {
      const result = await validator.validate({ projectPath: projectDir });
      expect(result.valid).toBe(false);
      expect(result.status).toBe("MANIFEST_INVALID");
      expect(result.reason).toContain("is a symbolic link");
    } finally {
      try {
        const { unlink } = await import("node:fs/promises");
        await unlink(symlinkPath);
      } catch {}
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it("SEC-03 Test 3: Rejects .discovery when it is a regular file", async () => {
    const projectDir = join(tmpdir(), `sec03-test-file-${Date.now()}-${Math.random()}`);
    await mkdir(projectDir, { recursive: true });

    const discFile = join(projectDir, ".discovery");
    await writeFile(discFile, "not a directory", "utf8");

    try {
      const result = await validator.validate({ projectPath: projectDir });
      expect(result.valid).toBe(false);
      expect(result.status).toBe("MANIFEST_INVALID");
      expect(result.reason).toContain("is not a directory");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it("SEC-03 Test 4: Rejects manifest.json when it is a symbolic link", async () => {
    const baseDir = join(tmpdir(), `sec03-test-manifest-${Date.now()}-${Math.random()}`);
    const projectDir = join(baseDir, "project");
    const discoveryDir = join(projectDir, ".discovery");
    await mkdir(discoveryDir, { recursive: true });

    const outsideManifest = join(baseDir, "outside-manifest.json");
    const manifest = {
      schemaVersion: 1,
      repository: { name: "test", path: projectDir },
      engine: { packageVersion: "0.1.0", commitSha: "abc", bunVersion: "bun-v1.3.0" },
      analysis: { projectId: "00000000-0000-4000-8000-000000000001", generatedAt: new Date().toISOString() },
      requiredArtifacts: [],
      artifacts: {},
    };
    await writeFile(outsideManifest, JSON.stringify(manifest), "utf8");

    const manifestSymlink = join(discoveryDir, "manifest.json");
    try {
      const { symlink } = await import("node:fs/promises");
      await symlink(outsideManifest, manifestSymlink, "file");
    } catch {
      await rm(baseDir, { recursive: true, force: true });
      return;
    }

    try {
      const result = await validator.validate({ projectPath: projectDir });
      expect(result.valid).toBe(false);
      expect(result.status).toBe("MANIFEST_INVALID");
      expect(result.reason).toContain("is a symbolic link");
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});

describe("R02 freshness evidence", () => {
  async function fixture() {
    const path = join(tmpdir(), `r02-validator-${randomUUID()}`);
    const directory = join(path, ".discovery");
    await mkdir(directory, { recursive: true });
    const source = "export const alpha = 1;\n";
    await writeFile(join(path, "index.js"), source);
    const filesRaw = JSON.stringify([{ path: "index.js", size: Buffer.byteLength(source) }]);
    const manifest: DiscoveryManifest = {
      schemaVersion: 1,
      repository: { name: "r02", path, sourceDigest: await computeWorkspaceDigest(path) },
      engine: { packageVersion: "0.1.0", commitSha: "abc", bunVersion: "1.4.2" },
      analysis: { projectId: randomUUID(), generatedAt: new Date().toISOString() },
      requiredArtifacts: ["files.json"],
      artifacts: {},
    };
    const saveManifest = () => writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
    const saveInventory = async (raw: string) => {
      await writeFile(join(directory, "files.json"), raw);
      manifest.artifacts["files.json"] = {
        sha256: createHash("sha256").update(raw).digest("hex"), bytes: Buffer.byteLength(raw),
      };
      await saveManifest();
    };
    await saveInventory(filesRaw);
    return { path, directory, source, filesRaw, manifest, saveManifest, saveInventory };
  }

  for (const changed of [false, true]) {
    it(`R02 rejects missing digest with ${changed ? "same-size changed" : "unchanged"} source but preserves inspection`, async () => {
      const f = await fixture();
      try {
        delete f.manifest.repository.sourceDigest;
        await f.saveManifest();
        if (changed) {
          const source = "export const bravo = 1;\n";
          expect(Buffer.byteLength(source)).toBe(Buffer.byteLength(f.source));
          expect(source).not.toBe(f.source);
          await writeFile(join(f.path, "index.js"), source);
        }
        const validator = new DiscoveryValidator();
        const inspection = await validator.validate({ projectPath: f.path });
        expect(inspection.valid).toBe(true);
        expect(inspection.status).toBe("VALID");
        expect(inspection.manifest?.repository.sourceDigest).toBeUndefined();
        for (const result of [
          await validator.validateFreshness(f.path),
          await validator.validate({ projectPath: f.path, verifyFreshness: true }),
        ]) {
          expect(result.valid).toBe(false);
          expect(result.status).toBe("SNAPSHOT_STALE");
          expect(result.reason).toContain("missing sourceDigest");
          expect(result.validatedArtifacts).toBeUndefined();
        }
      } finally { await rm(f.path, { recursive: true, force: true }); }
    });
  }

  for (const raw of ["{", "null", "{}", "[null]", '[{"path":"index.js","size":"24"}]',
    '[{"path":"index.js","size":-1}]', '[{"path":"","size":24}]', '[{"path":"index.js"}]']) {
    it(`R02 rejects checksum-valid malformed inventory ${raw} without throwing`, async () => {
      const f = await fixture();
      try {
        await f.saveInventory(raw);
        expect((await new DiscoveryValidator().validate({ projectPath: f.path })).status).toBe("VALID");
        const result = await new DiscoveryValidator().validateFreshness(f.path);
        expect(result.valid).toBe(false);
        expect(result.status).toBe("SNAPSHOT_STALE");
        expect(result.reason).toContain("files.json");
        expect(result.validatedArtifacts).toBeUndefined();
      } finally { await rm(f.path, { recursive: true, force: true }); }
    });
  }

  it("R02 cannot assert freshness using an inventory omitted from the validated artifact set", async () => {
    const f = await fixture();
    try {
      f.manifest.requiredArtifacts = [];
      delete f.manifest.artifacts["files.json"];
      await f.saveManifest();
      const result = await new DiscoveryValidator().validateFreshness(f.path);
      expect(result.valid).toBe(false);
      expect(result.status).toBe("SNAPSHOT_STALE");
      expect(result.reason).toContain("files.json");
      expect(result.validatedArtifacts).toBeUndefined();
    } finally { await rm(f.path, { recursive: true, force: true }); }
  });

  for (const validatedSizeIsWrong of [false, true]) {
    it(`R02 freshness consumes validated inventory despite later ${validatedSizeIsWrong ? "repair" : "corruption"} on disk`, async () => {
      const f = await fixture();
      const originalScan = FileScanner.prototype.scan;
      try {
        const checkedRaw = validatedSizeIsWrong
          ? JSON.stringify([{ path: "index.js", size: Buffer.byteLength(f.source) + 1 }]) : f.filesRaw;
        await f.saveInventory(checkedRaw);
        let replacements = 0;
        FileScanner.prototype.scan = async function (projectPath) {
          if (projectPath === f.path) {
            replacements++;
            await writeFile(join(f.directory, "files.json"), validatedSizeIsWrong ? f.filesRaw : "null");
          }
          return originalScan.call(this, projectPath);
        };
        const result = await new DiscoveryValidator().validateFreshness(f.path);
        expect(replacements).toBe(1);
        expect(result.valid).toBe(!validatedSizeIsWrong);
        expect(result.status).toBe(validatedSizeIsWrong ? "SNAPSHOT_STALE" : "VALID");
        if (validatedSizeIsWrong) {
          expect(result.reason).toContain("file size changed");
          expect(result.validatedArtifacts).toBeUndefined();
        } else {
          expect(result.validatedArtifacts?.get("files.json")).toBe(checkedRaw);
          expect(createHash("sha256").update(result.validatedArtifacts!.get("files.json")!).digest("hex"))
            .toBe(f.manifest.artifacts["files.json"]!.sha256);
        }
      } finally {
        FileScanner.prototype.scan = originalScan;
        await rm(f.path, { recursive: true, force: true });
      }
    });
  }
});
