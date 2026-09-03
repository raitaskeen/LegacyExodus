import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { createLegacyExodusEngine } from "@runtime/composition/services";
import { DiscoveryValidator } from "@discovery/discovery-validator";
import { DiscoveryQueryService } from "@discovery/discovery-query-service";
import { SqliteStorageProvider } from "@storage/adapters/sqlite-storage";
import { StorageManager } from "@storage/storage-manager";

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

  it("REUSE-02: Reused snapshot restores complete analysis artifacts into storage and query service", async () => {
    const sqliteDbPath = join(tmpdir(), `test-reuse02-db-${randomUUID()}.sqlite`);
    const projectId = randomUUID();
    const run1Id = randomUUID();
    const run2Id = randomUUID();

    try {
      // ─── RUN 1: Clean fresh run with SQLite storage ──────────────────────
      const engine1 = createLegacyExodusEngine({
        LOG_LEVEL: "silent",
        NODE_ENV: "test",
        LEGACY_EXODUS_STORAGE_DRIVER: "sqlite",
        LEGACY_EXODUS_STORAGE_DB_PATH: sqliteDbPath,
      });
      await engine1.initialize();
      const res1 = await engine1.execute({
        id: run1Id,
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId, path: testRepoDir },
      });
      await engine1.shutdown();

      expect(res1.type).toBe("AnalyzeProject");
      if (res1.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject");
      expect(res1.isReused).toBeUndefined();
      expect(res1.analysis.filesAnalyzed).toBeGreaterThanOrEqual(1);

      // Verify Run 1 facts in persistent storage
      const provider = new SqliteStorageProvider({ databasePath: sqliteDbPath });
      const storage = new StorageManager(provider);
      const query = new DiscoveryQueryService(storage);

      const run1Symbols = await query.getSymbolsForFile(projectId, "src/index.ts", run1Id);
      expect(run1Symbols.length).toBeGreaterThanOrEqual(1);
      const run1DepGraph = await query.getDependencyGraph(projectId, run1Id);
      expect(run1DepGraph).not.toBeNull();
      expect(run1DepGraph?.nodes.length).toBeGreaterThanOrEqual(1);

      // ─── RUN 2: Reused snapshot execution with fresh engine instance ────
      const engine2 = createLegacyExodusEngine({
        LOG_LEVEL: "silent",
        NODE_ENV: "test",
        LEGACY_EXODUS_STORAGE_DRIVER: "sqlite",
        LEGACY_EXODUS_STORAGE_DB_PATH: sqliteDbPath,
      });
      await engine2.initialize();
      const res2 = await engine2.execute({
        id: run2Id,
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId, path: testRepoDir },
      });
      await engine2.shutdown();

      expect(res2.type).toBe("AnalyzeProject");
      if (res2.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject");
      expect(res2.isReused).toBe(true);
      expect(res2.analysis.filesAnalyzed).toBe(res1.analysis.filesAnalyzed);

      // ─── VERIFY REUSE-02 RESTORATION ────────────────────────────────────
      // 1. Latest completed run must point to run2Id
      const latestRunId = await query.getLatestCompletedRunId(projectId);
      expect(latestRunId).toBe(run2Id);

      // 2. Symbols for file in run2Id must match run1Id symbols (not empty!)
      const run2Symbols = await query.getSymbolsForFile(projectId, "src/index.ts", run2Id);
      expect(run2Symbols.length).toBe(run1Symbols.length);
      expect(run2Symbols.map((s) => s.name).sort()).toEqual(run1Symbols.map((s) => s.name).sort());

      // 3. Default query (latest run) must return restored symbols
      const latestSymbols = await query.getSymbolsForFile(projectId, "src/index.ts");
      expect(latestSymbols.length).toBe(run1Symbols.length);

      // 4. Dependency graph for run2Id must be restored (not null!)
      const run2DepGraph = await query.getDependencyGraph(projectId, run2Id);
      expect(run2DepGraph).not.toBeNull();
      expect(run2DepGraph?.nodes.length).toBe(run1DepGraph?.nodes.length);

      // 5. Semantic analysis for run2Id must be restored
      const run2Semantic = await query.getSemanticAnalysis(projectId, run2Id);
      expect(run2Semantic).not.toBeNull();

      // 6. Knowledge graph for run2Id must be restored
      const run2Knowledge = await query.getKnowledgeGraph(projectId, run2Id);
      expect(run2Knowledge).not.toBeNull();

      await storage.close();
    } finally {
      try {
        await rm(sqliteDbPath, { force: true });
        await rm(`${sqliteDbPath}-wal`, { force: true });
        await rm(`${sqliteDbPath}-shm`, { force: true });
      } catch {}
    }
  });

  it("REUSE-02: Snapshot containing only discovery artifacts falls through to fresh analysis without false completed status", async () => {
    const dummyDir = join(tmpdir(), `test-reuse02-discovery-only-${randomUUID()}`);
    const discoveryDir = join(dummyDir, ".discovery");
    await mkdir(join(dummyDir, "src"), { recursive: true });
    await mkdir(discoveryDir, { recursive: true });

    await writeFile(join(dummyDir, "package.json"), JSON.stringify({ name: "disc-only", version: "1.0.0" }), "utf8");
    await writeFile(join(dummyDir, "src", "index.ts"), "export const x = 42;", "utf8");

    // Write discovery-only artifacts (no symbols.json, no dependency-graph.json)
    const projectPayload = { name: "disc-only", path: dummyDir, languages: ["typescript"] };
    const filesPayload = [{ id: "f-1", path: "src/index.ts", language: "typescript", fileKind: "source", size: 21 }];
    const depsPayload: any[] = [];
    const frameworksPayload: any[] = [];
    const summaryPayload = {
      projectName: "disc-only",
      fileCount: 1,
      dependencyCount: 0,
      frameworkCount: 0,
      languages: ["typescript"],
      enumerationFailureCount: 0,
      discoveryComplete: true,
    };

    await writeFile(join(discoveryDir, "project.json"), JSON.stringify(projectPayload), "utf8");
    await writeFile(join(discoveryDir, "files.json"), JSON.stringify(filesPayload), "utf8");
    await writeFile(join(discoveryDir, "dependencies.json"), JSON.stringify(depsPayload), "utf8");
    await writeFile(join(discoveryDir, "frameworks.json"), JSON.stringify(frameworksPayload), "utf8");
    await writeFile(join(discoveryDir, "summary.json"), JSON.stringify(summaryPayload), "utf8");

    const manifest = {
      schemaVersion: 1,
      repository: { name: "disc-only", path: dummyDir },
      engine: { packageVersion: "0.1.0", commitSha: "test", bunVersion: "bun-v1.3.0" },
      analysis: { projectId: randomUUID(), generatedAt: new Date().toISOString() },
      requiredArtifacts: ["project.json", "files.json", "dependencies.json", "frameworks.json", "summary.json"],
      artifacts: {
        "project.json": { sha256: "dummy", bytes: 10 },
        "files.json": { sha256: "dummy", bytes: 10 },
        "dependencies.json": { sha256: "dummy", bytes: 10 },
        "frameworks.json": { sha256: "dummy", bytes: 10 },
        "summary.json": { sha256: "dummy", bytes: 10 },
      },
    };

    // Calculate actual SHA256s for manifest
    const { createHash } = await import("node:crypto");
    for (const art of manifest.requiredArtifacts) {
      const content = await readFile(join(discoveryDir, art));
      manifest.artifacts[art as keyof typeof manifest.artifacts] = {
        sha256: createHash("sha256").update(content).digest("hex"),
        bytes: content.byteLength,
      };
    }
    await writeFile(join(discoveryDir, "manifest.json"), JSON.stringify(manifest), "utf8");

    const engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    await engine.initialize();

    try {
      const res = await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: dummyDir },
      });

      expect(res.type).toBe("AnalyzeProject");
      if (res.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject");
      // Must NOT be marked as reused because discovery-only snapshot fell through to fresh analysis!
      expect(res.isReused).toBeUndefined();
      expect(res.analysis.filesAnalyzed).toBe(1);

      // Verify that full analysis artifacts were generated as part of fresh analysis
      const newManifestRaw = await readFile(join(discoveryDir, "manifest.json"), "utf8");
      const newManifest = JSON.parse(newManifestRaw);
      expect(newManifest.requiredArtifacts).toContain("dependency-graph.json");
      expect(newManifest.requiredArtifacts).toContain("symbols.json");
    } finally {
      await engine.shutdown();
      await rm(dummyDir, { recursive: true, force: true });
    }
  });

  it("REUSE-03: Invariant bytes validated == bytes consumed: handler consumes in-memory validated artifacts and rejects tampered disk files", async () => {
    const engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    await engine.initialize();

    try {
      // Run 1: Create valid initial snapshot
      const run1 = await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: testRepoDir },
      });
      expect(run1.type).toBe("AnalyzeProject");
      if (run1.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject");

      // Run 2: Unchanged workspace reuse
      const run2 = await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: testRepoDir },
      });
      expect(run2.type).toBe("AnalyzeProject");
      if (run2.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject");
      expect(run2.isReused).toBe(true);

      // Now tamper with an artifact on disk (e.g. inject corrupted/tampered bytes)
      const discoveryDir = join(testRepoDir, ".discovery");
      await writeFile(join(discoveryDir, "symbols.json"), "corrupted-unvalidated-content", "utf8");

      // Run 3: The tampered artifact on disk must trigger CHECKSUM_MISMATCH in validator
      // and NOT be consumed as a reused snapshot!
      const run3 = await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: testRepoDir },
      });
      expect(run3.type).toBe("AnalyzeProject");
      if (run3.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject");
      // Must NOT be reused; must fall through to fresh analysis because on-disk bytes failed validation
      expect(run3.isReused).toBeUndefined();
      expect(run3.analysis.filesAnalyzed).toBe(run1.analysis.filesAnalyzed);
    } finally {
      await engine.shutdown();
    }
  });
});
