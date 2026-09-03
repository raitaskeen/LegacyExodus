import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { createLegacyExodusEngine } from "@runtime/composition/services";
import { DiscoveryValidator } from "@discovery/discovery-validator";

describe("Phase 3A P0.4 — Discovery Snapshot Reuse & Invalidation", () => {
  let testRepoDir: string;

  beforeEach(async () => {
    testRepoDir = join(tmpdir(), `legacy-exodus-reuse-test-${randomUUID()}`);
    await mkdir(join(testRepoDir, "src"), { recursive: true });

    // Create a minimal package.json
    await writeFile(
      join(testRepoDir, "package.json"),
      JSON.stringify(
        {
          name: "test-reuse-project",
          version: "1.0.0",
          dependencies: {
            express: "^4.18.2",
          },
          devDependencies: {
            typescript: "^5.0.0",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    // Create a couple of JS/TS source files
    await writeFile(
      join(testRepoDir, "src", "index.ts"),
      `
      import express from "express";
      export const app = express();
      export function start(port: number) {
        app.listen(port);
      }
      `,
      "utf8",
    );

    await writeFile(
      join(testRepoDir, "src", "helper.js"),
      `
      function add(a, b) {
        return a + b;
      }
      module.exports = { add };
      `,
      "utf8",
    );
  });

  afterEach(async () => {
    try {
      await rm(testRepoDir, { recursive: true, force: true });
    } catch {}
  });

  it("Scenario 1: Fresh run discovers project, persists valid snapshot with SHA-256", async () => {
    const engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    await engine.initialize();

    try {
      const result = await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: testRepoDir },
      });

      expect(result.type).toBe("AnalyzeProject");
      if (result.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject result");
      expect(result.discovery.projectName).toBe("test-reuse-project");
      expect(result.discovery.files.length).toBeGreaterThanOrEqual(3);
      expect(result.discovery.dependencies.length).toBe(2);
      expect(result.analysis.filesAnalyzed).toBe(2); // index.ts and helper.js

      // Verify .discovery/manifest.json is valid
      const validator = new DiscoveryValidator();
      const validation = await validator.validate({ projectPath: testRepoDir });
      expect(validation.valid).toBe(true);
      expect(validation.status).toBe("VALID");
      expect(validation.manifest).toBeDefined();
    } finally {
      await engine.shutdown();
    }
  });

  it("Scenario 2: Second run on valid snapshot reuses discovery without full re-parsing", async () => {
    const engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    await engine.initialize();

    try {
      // 1. First run creates the valid snapshot
      const firstRun = await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: testRepoDir },
      });
      expect(firstRun.type).toBe("AnalyzeProject");
      if (firstRun.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject");
      expect(firstRun.discovery.files.length).toBeGreaterThanOrEqual(3);

      // 2. Second run on same repo
      const secondRun = await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: testRepoDir },
      });

      expect(secondRun.type).toBe("AnalyzeProject");
      if (secondRun.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject");
      expect(secondRun.discovery.projectName).toBe("test-reuse-project");
      expect(secondRun.discovery.files.length).toBe(firstRun.discovery.files.length);
      expect(secondRun.discovery.dependencies.length).toBe(firstRun.discovery.dependencies.length);
      expect(secondRun.analysis.filesAnalyzed).toBe(firstRun.analysis.filesAnalyzed);
      expect(secondRun.analysis.filesDiscovered).toBe(firstRun.analysis.filesDiscovered);
      expect(secondRun.analysis.durationMs).toBeLessThanOrEqual(firstRun.analysis.durationMs + 50);

      // Snapshot remains valid
      const validator = new DiscoveryValidator();
      const validation = await validator.validate({ projectPath: testRepoDir });
      expect(validation.valid).toBe(true);
    } finally {
      await engine.shutdown();
    }
  });

  it("Scenario 3: Corrupted projection artifact triggers invalidation and safe fresh fallback", async () => {
    const engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    await engine.initialize();

    try {
      // 1. First run generates valid snapshot
      await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: testRepoDir },
      });

      // 2. Corrupt one artifact by appending invalid data
      const filesJsonPath = join(testRepoDir, ".discovery", "files.json");
      await writeFile(filesJsonPath, "[] /* corrupted */", "utf8");

      // Verify validator detects the checksum mismatch
      const validator = new DiscoveryValidator();
      const preValidation = await validator.validate({ projectPath: testRepoDir });
      expect(preValidation.valid).toBe(false);
      expect(preValidation.status).toBe("CHECKSUM_MISMATCH");

      // 3. Re-running analyze should detect the invalidation and safely re-run fresh discovery
      const recoveryRun = await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: testRepoDir },
      });

      expect(recoveryRun.type).toBe("AnalyzeProject");
      if (recoveryRun.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject");
      expect(recoveryRun.discovery.files.length).toBeGreaterThanOrEqual(3);

      // Snapshot is restored to valid state
      const postValidation = await validator.validate({ projectPath: testRepoDir });
      expect(postValidation.valid).toBe(true);
      expect(postValidation.status).toBe("VALID");
    } finally {
      await engine.shutdown();
    }
  });

  it("Scenario 4: Explicit refresh forces fresh discovery even if snapshot is valid", async () => {
    const engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    await engine.initialize();

    try {
      // 1. Initial run
      await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: testRepoDir },
      });

      // Add a new file to the repo
      await writeFile(join(testRepoDir, "src", "new-module.ts"), "export const x = 42;", "utf8");

      // 2. Run with refresh: true
      const refreshedRun = await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: testRepoDir, refresh: true },
      });

      // Refreshed run sees the new file
      expect(refreshedRun.type).toBe("AnalyzeProject");
      if (refreshedRun.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject");
      const foundNewFile = refreshedRun.discovery.files.some((f: { path: string }) => f.path.includes("new-module.ts"));
      expect(foundNewFile).toBe(true);
    } finally {
      await engine.shutdown();
    }
  });

  it("Scenario 5: Project isolation prevents cross-project cache contamination", async () => {
    const projectBDir = join(tmpdir(), `legacy-exodus-reuse-projB-${randomUUID()}`);
    await mkdir(join(projectBDir, "src"), { recursive: true });
    await writeFile(
      join(projectBDir, "package.json"),
      JSON.stringify({ name: "project-b", version: "2.0.0" }, null, 2),
      "utf8",
    );
    await writeFile(join(projectBDir, "src", "b.js"), "module.exports = 'B';", "utf8");

    const engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    await engine.initialize();

    try {
      // Analyze Project A
      const resA = await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: testRepoDir },
      });

      // Analyze Project B
      const resB = await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: projectBDir },
      });

      expect(resA.type).toBe("AnalyzeProject");
      expect(resB.type).toBe("AnalyzeProject");
      if (resA.type !== "AnalyzeProject" || resB.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject");
      expect(resA.discovery.projectName).toBe("test-reuse-project");
      expect(resB.discovery.projectName).toBe("project-b");
      expect(resA.discovery.projectPath).not.toBe(resB.discovery.projectPath);

      // Verify separate .discovery manifests
      const validator = new DiscoveryValidator();
      const valA = await validator.validate({ projectPath: testRepoDir });
      const valB = await validator.validate({ projectPath: projectBDir });

      expect(valA.valid).toBe(true);
      expect(valB.valid).toBe(true);
      expect(valA.manifest?.repository.name).toBe("test-reuse-project");
      expect(valB.manifest?.repository.name).toBe("project-b");
    } finally {
      await engine.shutdown();
      try {
        await rm(projectBDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it("REUSE-01 Case A: Unchanged workspace reuses snapshot deterministically", async () => {
    const engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    await engine.initialize();

    try {
      // Run 1: Initial fresh discovery and analysis
      const run1 = await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: testRepoDir },
      });
      expect(run1.type).toBe("AnalyzeProject");
      if (run1.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject");
      expect(run1.isReused).toBeUndefined();

      // Run 2: Without modifying workspace, execute again with refresh: false
      const run2 = await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: testRepoDir, refresh: false },
      });
      expect(run2.type).toBe("AnalyzeProject");
      if (run2.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject");
      expect(run2.isReused).toBe(true);
      expect(run2.discovery.files.length).toBe(run1.discovery.files.length);
    } finally {
      await engine.shutdown();
    }
  });

  it("REUSE-01 Case B: Changed workspace (in-place source edit) rejects snapshot reuse without --refresh", async () => {
    const engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    await engine.initialize();

    try {
      // Run 1: Initial fresh discovery and analysis
      const run1 = await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: testRepoDir },
      });
      expect(run1.type).toBe("AnalyzeProject");
      if (run1.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject");

      // Verify snapshot is currently valid and fresh
      const validator = new DiscoveryValidator();
      const valInitial = await validator.validateFreshness(testRepoDir);
      expect(valInitial.valid).toBe(true);
      expect(valInitial.status).toBe("VALID");

      // Modify existing source file in-place (changing content)
      await writeFile(
        join(testRepoDir, "src", "index.ts"),
        `
        import express from "express";
        export const app = express();
        export const NEW_EXPORT = "remediation-test";
        export function start(port: number) {
          app.listen(port);
        }
        `,
        "utf8",
      );

      // Verify validator detects staleness
      const valModified = await validator.validateFreshness(testRepoDir);
      expect(valModified.valid).toBe(false);
      expect(valModified.status).toBe("SNAPSHOT_STALE");
      expect(valModified.reason).toMatch(/(Workspace file size changed|digest mismatch)/);

      // Run 2: Execute with refresh: false (default). Must NOT reuse stale snapshot!
      const run2 = await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: testRepoDir, refresh: false },
      });

      expect(run2.type).toBe("AnalyzeProject");
      if (run2.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject");
      // Must not be reused
      expect(run2.isReused).toBeUndefined();

      // Snapshot is refreshed and valid again
      const valPost = await validator.validateFreshness(testRepoDir);
      expect(valPost.valid).toBe(true);
      expect(valPost.status).toBe("VALID");
    } finally {
      await engine.shutdown();
    }
  });

  it("REUSE-01 Case B1 (same-size edit): In-place source edit with identical byte size triggers digest mismatch and rejects reuse", async () => {
    const engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    await engine.initialize();

    try {
      // Run 1: Initial fresh discovery and analysis
      const run1 = await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: testRepoDir },
      });
      expect(run1.type).toBe("AnalyzeProject");
      if (run1.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject");

      // Replace helper.js with identical byte length content
      const oldHelper = await readFile(join(testRepoDir, "src", "helper.js"), "utf8");
      // Change 'function add(a, b)' to 'function sum(a, b)' (both are exactly 18 characters)
      const newHelper = oldHelper.replace("function add(a, b)", "function sum(a, b)");
      expect(Buffer.byteLength(newHelper)).toBe(Buffer.byteLength(oldHelper));
      await writeFile(join(testRepoDir, "src", "helper.js"), newHelper, "utf8");

      // Verify validator detects staleness via digest mismatch
      const validator = new DiscoveryValidator();
      const valModified = await validator.validateFreshness(testRepoDir);
      expect(valModified.valid).toBe(false);
      expect(valModified.status).toBe("SNAPSHOT_STALE");
      expect(valModified.reason).toContain("digest mismatch");

      // Run 2: Execute without refresh. Must NOT reuse!
      const run2 = await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: testRepoDir, refresh: false },
      });
      if (run2.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject");
      expect(run2.isReused).toBeUndefined();
    } finally {
      await engine.shutdown();
    }
  });

  it("REUSE-01 Case B2: Added file rejects snapshot reuse without --refresh", async () => {
    const engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    await engine.initialize();

    try {
      // Run 1: Initial run
      const run1 = await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: testRepoDir },
      });
      if (run1.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject");
      const initialFileCount = run1.discovery.files.length;

      // Add a new source file to the workspace
      await writeFile(join(testRepoDir, "src", "added.ts"), "export const added = true;", "utf8");

      // Run 2: Execute with refresh: false. Must detect new file and run fresh discovery!
      const run2 = await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: testRepoDir, refresh: false },
      });
      if (run2.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject");
      expect(run2.isReused).toBeUndefined();
      expect(run2.discovery.files.length).toBe(initialFileCount + 1);
      expect(run2.discovery.files.some((f: { path: string }) => f.path === "src/added.ts")).toBe(true);
    } finally {
      await engine.shutdown();
    }
  });

  it("REUSE-01 Case B3: Removed file rejects snapshot reuse without --refresh", async () => {
    const engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    await engine.initialize();

    try {
      // Run 1: Initial run
      const run1 = await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: testRepoDir },
      });
      if (run1.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject");
      const initialFileCount = run1.discovery.files.length;

      // Delete an existing source file from the workspace
      await rm(join(testRepoDir, "src", "helper.js"));

      // Run 2: Execute with refresh: false. Must detect deleted file and run fresh discovery!
      const run2 = await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: testRepoDir, refresh: false },
      });
      if (run2.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject");
      expect(run2.isReused).toBeUndefined();
      expect(run2.discovery.files.length).toBe(initialFileCount - 1);
      expect(run2.discovery.files.some((f: { path: string }) => f.path === "src/helper.js")).toBe(false);
    } finally {
      await engine.shutdown();
    }
  });

  it("REUSE-01 Case C: Explicit --refresh forces fresh discovery even when snapshot is fresh", async () => {
    const engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    await engine.initialize();

    try {
      // Run 1: Initial run
      const run1 = await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: testRepoDir },
      });
      if (run1.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject");

      // Run 2: Workspace is completely unchanged, but refresh: true is passed
      const run2 = await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: testRepoDir, refresh: true },
      });
      if (run2.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject");
      // Must not be reused because refresh was forced
      expect(run2.isReused).toBeUndefined();
    } finally {
      await engine.shutdown();
    }
  });
});
