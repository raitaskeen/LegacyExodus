import { RunScopedAstStore } from "@core/orchestration/run-scoped-ast-store";
import { LegacyExodusError } from "@shared/errors";
import { analysisRunPayloadSchema, controlFlowPayloadSchema, dataFlowPayloadSchema } from "@contracts/discovery-storage";
import { computeFileAccounting, detectContamination, verifyCompleteness } from "../../benchmarks/governance";
import { AnalyzeProjectHandler } from "@core/orchestration/command-handler";
import { DiscoveryEngine } from "@discovery/index";
import { createEngineContext } from "@runtime/composition/services";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";

import { semanticAnalysisPayloadSchema } from "@contracts/discovery-storage";
import { createLegacyExodusEngine } from "@runtime/composition/services";
import type { LegacyExodusEngine } from "@core/engine";
import { DiscoveryValidator } from "@discovery/discovery-validator";
import { computeManifestMac, manifestKeyId, MANIFEST_MAC_ALGORITHM, SnapshotKeyStore } from "@discovery/index";
import { FileScanner } from "@discovery/file-scanner";
import { DiscoveryQueryService } from "@discovery/discovery-query-service";
import { JavaScriptParser, ParserManager, ParserRegistry } from "@parser/index";
import { SqliteStorageProvider } from "@storage/adapters/sqlite-storage";
import { StorageManager } from "@storage/storage-manager";
import { JavaScriptSymbolExtractor, validateCodeSymbols } from "@symbols/index";

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
      expect(firstRun.isReused).toBeUndefined();
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
      expect(secondRun.isReused).toBe(true);
      expect(secondRun.discovery.projectName).toBe("test-reuse-project");
      expect(secondRun.discovery.files.length).toBe(firstRun.discovery.files.length);
      expect(secondRun.discovery.dependencies.length).toBe(firstRun.discovery.dependencies.length);
      expect(secondRun.analysis.filesAnalyzed).toBe(firstRun.analysis.filesAnalyzed);
      expect(secondRun.analysis.filesDiscovered).toBe(firstRun.analysis.filesDiscovered);

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

  it("STORAGE-001: preserves canonical symbol metadata across validated snapshot reuse", async () => {
    const sqliteDbPath = join(tmpdir(), `test-storage001-db-${randomUUID()}.sqlite`);
    const projectId = randomUUID();
    const run1Id = randomUUID();
    const run2Id = randomUUID();
    const source = [
      "export async function example(a: string, b = 1) { const local = a; return local; }",
      "export class Service { async execute(input: string) { return input; } }",
    ].join("\n");

    await writeFile(join(testRepoDir, "src", "index.ts"), source, "utf8");

    const parserRegistry = new ParserRegistry();
    parserRegistry.register(new JavaScriptParser());
    const canonicalAst = await new ParserManager(parserRegistry).parse({
      file: { id: "storage-001-fixture", path: "src/index.ts", language: "typescript", size: source.length },
      source,
    });
    const canonicalSymbols = new JavaScriptSymbolExtractor().extract(canonicalAst).symbols;
    const serializedCanonicalSymbols = validateCodeSymbols(JSON.parse(JSON.stringify(canonicalSymbols)));
    const serializedCanonicalSymbolsJson = JSON.stringify(serializedCanonicalSymbols);

    const environment = {
      LOG_LEVEL: "silent",
      NODE_ENV: "test",
      LEGACY_EXODUS_STORAGE_DRIVER: "sqlite",
      LEGACY_EXODUS_STORAGE_DB_PATH: sqliteDbPath,
    } as const;
    let storage: StorageManager | undefined;
    let engine1: LegacyExodusEngine | undefined;
    let engine2: LegacyExodusEngine | undefined;

    try {
      try {
        engine1 = createLegacyExodusEngine(environment);
        await engine1.initialize();
        await engine1.execute({
          id: run1Id,
          type: "AnalyzeProject",
          createdAt: new Date(),
          payload: { projectId, path: testRepoDir },
        });
      } finally {
        await engine1?.shutdown();
      }

      storage = new StorageManager(new SqliteStorageProvider({ databasePath: sqliteDbPath }));
      const query = new DiscoveryQueryService(storage);
      const persistedSymbols = await query.getSymbolsForFile(projectId, "src/index.ts", run1Id);

      let reusedResult: Awaited<ReturnType<LegacyExodusEngine["execute"]>>;
      try {
        engine2 = createLegacyExodusEngine(environment);
        await engine2.initialize();
        reusedResult = await engine2.execute({
          id: run2Id,
          type: "AnalyzeProject",
          createdAt: new Date(),
          payload: { projectId, path: testRepoDir },
        });
      } finally {
        await engine2?.shutdown();
      }

      const reusedSymbols = await query.getSymbolsForFile(projectId, "src/index.ts", run2Id);

      expect(reusedResult.type).toBe("AnalyzeProject");
      if (reusedResult.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject");
      expect(reusedResult.isReused).toBe(true);
      expect(JSON.stringify(persistedSymbols)).toBe(serializedCanonicalSymbolsJson);
      expect(JSON.stringify(reusedSymbols)).toBe(serializedCanonicalSymbolsJson);
      expect(reusedSymbols).toEqual(persistedSymbols);

    } finally {
      await storage?.close();
      await rm(sqliteDbPath, { force: true });
      await rm(`${sqliteDbPath}-wal`, { force: true });
      await rm(`${sqliteDbPath}-shm`, { force: true });
    }
  });

  it("SCHEMA-001: invalidates an integrity-valid snapshot with malformed nested semantic state", async () => {
    const projectId = randomUUID();
    const engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    await engine.initialize();

    try {
      const firstRun = await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId, path: testRepoDir },
      });
      expect(firstRun.type).toBe("AnalyzeProject");

      const discoveryDir = join(testRepoDir, ".discovery");
      const semanticPath = join(discoveryDir, "semantic.json");
      const manifestPath = join(discoveryDir, "manifest.json");
      const semantic = JSON.parse(await readFile(semanticPath, "utf8"));
      const malformedSemantic = `${JSON.stringify({
        ...semantic,
        calls: [{ id: "call-without-required-structure" }],
      }, null, 2)}\n`;
      await writeFile(semanticPath, malformedSemantic, "utf8");

      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      manifest.artifacts["semantic.json"] = {
        sha256: createHash("sha256").update(malformedSemantic).digest("hex"),
        bytes: Buffer.byteLength(malformedSemantic, "utf8"),
      };
      // F-001: re-authenticate as this machine's analyzer would, so rejection below comes from deep schema validation.
      const key = await new SnapshotKeyStore().readKey();
      if (key === undefined) throw new Error("Expected the fresh run to create a local snapshot key.");
      manifest.integrity = { algorithm: MANIFEST_MAC_ALGORITHM, keyId: manifestKeyId(key), mac: computeManifestMac(manifest, key) };
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

      const validator = new DiscoveryValidator();
      expect((await validator.validate({ projectPath: testRepoDir, authorizeReuse: true })).status).toBe("VALID");

      const recoveryRun = await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId, path: testRepoDir },
      });
      expect(recoveryRun.type).toBe("AnalyzeProject");
      if (recoveryRun.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject");
      expect(recoveryRun.isReused).toBeUndefined();

      const recoveredSemantic = JSON.parse(await readFile(semanticPath, "utf8"));
      expect(semanticAnalysisPayloadSchema.safeParse(recoveredSemantic).success).toBe(true);
    } finally {
      await engine.shutdown();
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
      schemaVersion: 2,
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


describe("R01 frozen snapshot disposition", () => {
  async function fixture(source: string) {
    const path = join(tmpdir(), `r01-disposition-${randomUUID()}`);
    await mkdir(path);
    await writeFile(join(path, "package.json"), '{"name":"r01"}');
    await writeFile(join(path, "ok.js"), "export function ok() { return 1; }");
    await writeFile(join(path, "bad.js"), source);
    const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    const handler = new AnalyzeProjectHandler(new DiscoveryEngine(), context.parserManager, new JavaScriptSymbolExtractor());
    const projectId = randomUUID();
    const run = () => handler.handle({
      id: randomUUID(), type: "AnalyzeProject", createdAt: new Date(), payload: { projectId, path },
    });
    const cold = await run();
    await context.storage.saveBatch(cold.records);
    const discovery = cold.records.find((record) => record.type === "project-discovery");
    if (!discovery) throw new Error("Missing discovery");
    await context.discoveryProjection.project(discovery.id);
    return { path, cold, run, context };
  }

  it("R1 parser-failure warm accounting preserves the cold outcome", async () => {
    const f = await fixture("export function broken( {");
    try {
      expect(f.cold.analysis).toMatchObject({ filesDiscovered: 3, filesAnalyzed: 1, parserFailures: 1 });
      const warm = await f.run();
      expect(warm.isReused).toBe(true);
      expect(warm.analysis).toMatchObject({ filesDiscovered: 3, filesAnalyzed: 1, parserFailures: 1 });
    } finally { await f.context.discoveryProjection.stop(); await f.context.storage.close(); await rm(f.path, { recursive: true, force: true }); }
  });

  it("R2 failed path never receives a synthetic empty table on reuse", async () => {
    const f = await fixture("export function broken( {");
    try {
      expect(f.cold.records.filter((r) => r.type === "symbol-table").map((r) => (r.payload as { path: string }).path)).toEqual(["ok.js"]);
      const warm = await f.run();
      expect(warm.isReused).toBe(true);
      expect(warm.records.filter((r) => r.type === "symbol-table").map((r) => (r.payload as { path: string }).path)).toEqual(["ok.js"]);
    } finally { await f.context.discoveryProjection.stop(); await f.context.storage.close(); await rm(f.path, { recursive: true, force: true }); }
  });

  it("R3 historical missing capability is readable but falls back fresh", async () => {
    const f = await fixture("export const good = 2;");
    try {
      await rewriteR01Artifact(f.path, "summary.json", (summary) => { delete summary.analysisDisposition; return summary; });
      expect((await new DiscoveryValidator().validateFreshness(f.path)).status).toBe("VALID");
      expect((await f.run()).isReused).toBeUndefined();
    } finally { await f.context.discoveryProjection.stop(); await f.context.storage.close(); await rm(f.path, { recursive: true, force: true }); }
  });

  it("R5 unknown capability is checksum-valid but cannot be reused", async () => {
    const f = await fixture("export const good = 2;");
    try {
      await rewriteR01Artifact(f.path, "summary.json", (summary) => ({ ...summary, analysisDisposition: { contract: "unknown-r01", files: [] } }));
      expect((await new DiscoveryValidator().validateFreshness(f.path)).status).toBe("VALID");
      expect((await f.run()).isReused).toBeUndefined();
    } finally { await f.context.discoveryProjection.stop(); await f.context.storage.close(); await rm(f.path, { recursive: true, force: true }); }
  });
});

async function rewriteR01Artifact(path: string, name: string, rewrite: (value: Record<string, unknown>) => unknown): Promise<void> {
  const directory = join(path, ".discovery");
  const bytes = `${JSON.stringify(rewrite(JSON.parse(await readFile(join(directory, name), "utf8"))), null, 2)}\n`;
  await writeFile(join(directory, name), bytes);
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  manifest.artifacts[name] = { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: Buffer.byteLength(bytes) };
  await writeFile(join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}


describe("R01 complete accounting and capability oracles", () => {
  const sources = { "package.json": '{"name":"r01"}', "ok.js": "export function ok() { return 1; }", "bad.js": "export const good = 2;" };
  const secondSources = { "a.js": "export function alpha() { return 1; }", "b.js": 'import { alpha } from "./a.js"; export function beta() { return alpha(); }' };

  async function prepare(files: Readonly<Record<string, string>>, fault?: "extraction" | "restore" | "restore-errors" | "parse-errors") {
    const path = join(tmpdir(), `r01-oracle-${randomUUID()}`);
    await mkdir(path);
    for (const [name, source] of Object.entries(files)) await writeFile(join(path, name), source);
    const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    const counts = { parser: 0, extractor: 0, reads: 0 };
    let activeFault = fault;
    const originalParse = context.parserManager.parse.bind(context.parserManager);
    context.parserManager.parse = async (request) => {
      counts.parser++;
      const ast = await originalParse(request);
      return activeFault === "parse-errors" && request.file.path === "bad.js"
        ? { ...ast, errors: [{ code: "R01_INITIAL_AST_ERROR", message: "Injected initial error" }] } : ast;
    };
    const extractor = new JavaScriptSymbolExtractor();
    const originalExtract = extractor.extract.bind(extractor);
    extractor.extract = (ast) => {
      counts.extractor++;
      if (activeFault === "extraction" && ast.metadata.sourcePath === "bad.js") {
        throw new LegacyExodusError({ code: "R01_EXTRACTION_INJECTED", message: "Injected extraction failure" });
      }
      return originalExtract(ast);
    };
    const handler = new AnalyzeProjectHandler(new DiscoveryEngine(), context.parserManager, extractor, undefined, async () => {
      const store = await RunScopedAstStore.create();
      return {
        write: (ast) => store.write(ast),
        read: async (file) => {
          counts.reads++;
          if (activeFault === "restore" && file === "a.js") {
            throw new LegacyExodusError({ code: "AST_RESTORE_INJECTED", message: "Injected AST restore failure" });
          }
          const ast = await store.read(file);
          return activeFault === "restore-errors" && file === "a.js"
            ? { ...ast, errors: [{ code: "R01_RESTORED_AST_ERROR", message: "Injected restored error" }] } : ast;
        },
        dispose: () => store.dispose(),
      };
    });
    const projectId = randomUUID();
    const run = (refresh?: boolean) => handler.handle({ id: randomUUID(), type: "AnalyzeProject", createdAt: new Date(), payload: { projectId, path, ...(refresh === undefined ? {} : { refresh }) } });
    const cold = await run();
    await context.storage.saveBatch(cold.records);
    const discovery = cold.records.find((record) => record.type === "project-discovery");
    if (!discovery) throw new Error("Missing discovery");
    await context.discoveryProjection.project(discovery.id);
    return {
      path, cold, context, counts, run, recovery: () => { activeFault = undefined; },
      close: async () => { await context.discoveryProjection.stop(); await context.storage.close(); await rm(path, { recursive: true, force: true }); },
    };
  }

  const vector = (execution: Awaited<ReturnType<AnalyzeProjectHandler["handle"]>>) => {
    const a = execution.analysis;
    if (!a) throw new Error("Missing completed analysis");
    return [a.filesDiscovered, a.filesAnalyzed, a.parserFailures, a.symbolExtractionFailures, a.unsupportedFiles,
      a.nonSourceArtifacts, a.unclassifiedArtifacts, a.enumerationFailures, a.secondPassFailures, a.discoveryComplete];
  };
  const disposition = (execution: Awaited<ReturnType<AnalyzeProjectHandler["handle"]>>) => {
    const run = execution.records.find((record) => record.type === "analysis-run");
    const parsed = analysisRunPayloadSchema.parse(run?.payload);
    if (!parsed.analysisDisposition) throw new Error("Missing disposition");
    expect(Object.hasOwn(run!.payload as object, "isReused")).toBe(false);
    return parsed.analysisDisposition;
  };
  const assertAccounting = (execution: Awaited<ReturnType<AnalyzeProjectHandler["handle"]>>, review: "PASS" | "NEEDS_REVIEW") => {
    if (!execution.analysis) throw new Error("Missing analysis");
    const accounting = computeFileAccounting(execution.analysis);
    expect(accounting).toMatchObject({ reconciles: true, discrepancy: 0, computedTotal: execution.analysis.filesDiscovered });
    expect(verifyCompleteness(execution.analysis, accounting, detectContamination([])).status).toBe(review);
    expect(execution.analysis.secondPassFailures!).toBeLessThanOrEqual(execution.analysis.filesAnalyzed);
  };

  for (const mode of ["clean", "parser", "extraction", "empty", "restore", "restore-errors", "parse-errors"] as const) {
    it(`R01 exact cold/warm ${mode} accounting, membership, work and payload equivalence`, async () => {
      const f = await prepare(mode === "empty" ? { "package.json": '{"name":"r01"}', "empty.js": "" }
        : mode === "restore" || mode === "restore-errors" ? secondSources
        : { ...sources, ...(mode === "parser" ? { "bad.js": "export function broken( {" } : {}) },
        mode === "extraction" || mode === "restore" || mode === "restore-errors" || mode === "parse-errors" ? mode : undefined);
      try {
        const expected = mode === "empty" ? [2,1,0,0,0,1,0,0,0,true]
          : mode === "restore" || mode === "restore-errors" ? [2,2,0,0,0,0,0,0,1,true]
          : mode === "parser" || mode === "parse-errors" ? [3,1,1,0,0,1,0,0,0,true]
          : mode === "extraction" ? [3,1,0,1,0,1,0,0,0,true] : [3,2,0,0,0,1,0,0,0,true];
        expect(vector(f.cold)).toEqual(expected);
        expect(f.cold.isReused).toBeUndefined();
        const before = { ...f.counts };
        const warm = await f.run();
        expect(warm.isReused).toBe(true);
        expect(vector(warm)).toEqual(expected);
        expect(f.counts).toEqual(before);
        expect(disposition(warm)).toEqual(disposition(f.cold));
        const logical = (execution: typeof warm) => execution.records.filter((r) =>
          ["dependency-graph", "semantic-analysis", "control-flow-analysis", "data-flow-analysis", "knowledge-graph"].includes(r.type))
          .map((r) => {
            const { projectId: _p, analysisRunId: _r, ...payload } = r.payload as Record<string, unknown>;
            return { type: r.type, payload: JSON.parse(JSON.stringify(payload)) };
          }).sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0);
        expect(logical(warm)).toEqual(logical(f.cold));
        // Frozen §59 equality covers persisted graph/semantic/flow/knowledge state.
        // Symbol-table membership/counts and serialized symbols are checked separately;
        // pre-existing convenience summary metadata is outside this R01 contract.
        const tableSymbols = (execution: typeof warm) => execution.records.filter((r) => r.type === "symbol-table")
          .map((r) => ({ path: (r.payload as { path: string }).path, symbols: (r.payload as { symbols: unknown }).symbols }))
          .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
        expect(JSON.stringify(tableSymbols(warm))).toBe(JSON.stringify(tableSymbols(f.cold)));
        expect(warm.events.filter((event) => event.type === "ParserFailure")).toEqual([]);
        assertAccounting(f.cold, mode === "clean" || mode === "empty" ? "PASS" : "NEEDS_REVIEW");
        assertAccounting(warm, mode === "clean" || mode === "empty" ? "PASS" : "NEEDS_REVIEW");
        const d = disposition(warm);
        expect(warm.records.filter((r) => r.type === "symbol-table")).toHaveLength(expected[1] as number);
        if (mode === "empty") expect(d.files).toEqual([{ fileId: warm.discovery!.files.find((file) => file.path === "empty.js")!.id, path: "empty.js", kind: "analyzed", symbolCount: 0 }]);
        if (mode === "parser" || mode === "parse-errors" || mode === "extraction") {
          expect(warm.records.some((r) => r.type === "symbol-table" && (r.payload as { path: string }).path === "bad.js")).toBe(false);
          expect(d.files.find((file) => file.path === "bad.js")?.kind).toBe(mode === "extraction" ? "symbol-extraction-failure" : "initial-parser-failure");
          if (mode === "extraction") expect(d.files.find((file) => file.path === "bad.js")).toMatchObject({ code: "R01_EXTRACTION_INJECTED" });
        }
        if (mode === "restore" || mode === "restore-errors") {
          expect(f.cold.events.filter((event) => event.type === "ParserFailure").map((event) => event.payload)).toEqual([
            { fileId: f.cold.discovery!.files.find((file) => file.path === "a.js")!.id, path: "a.js", code: mode === "restore" ? "AST_RESTORE_INJECTED" : "R01_RESTORED_AST_ERROR" },
          ]);
          expect(f.cold.events.some((event) => event.type === "AnalysisRunFailed")).toBe(false);
          expect(before).toEqual({ parser: 2, extractor: 2, reads: 2 });
          expect(d.files.find((file) => file.path === "a.js")).toMatchObject({ kind: "analyzed", secondPassFailure: { code: mode === "restore" ? "AST_RESTORE_INJECTED" : "R01_RESTORED_AST_ERROR" } });
          const cfg = controlFlowPayloadSchema.parse(f.cold.records.find((r) => r.type === "control-flow-analysis")!.payload);
          const dfg = dataFlowPayloadSchema.parse(f.cold.records.find((r) => r.type === "data-flow-analysis")!.payload);
          expect(cfg.graphs.filter((graph) => graph.filePath === "a.js")).toHaveLength(0);
          expect(dfg.graphs.filter((graph) => graph.filePath === "a.js")).toHaveLength(0);
          expect(cfg.graphs.filter((graph) => graph.filePath === "b.js")).toHaveLength(2);
          expect(dfg.graphs.filter((graph) => graph.filePath === "b.js")).toHaveLength(1);
          const semantic = semanticAnalysisPayloadSchema.parse(f.cold.records.find((r) => r.type === "semantic-analysis")!.payload);
          expect(semantic.calls).toHaveLength(1);
          expect(semantic.calls[0]).toMatchObject({ sourceFilePath: "b.js", resolutionState: "RESOLVED" });
          const target = validateCodeSymbols(f.cold.records.filter((r) => r.type === "symbol-table")
            .flatMap((r) => (r.payload as { symbols: unknown[] }).symbols)).find((symbol) => symbol.id === semantic.calls[0]!.targetSymbolId);
          expect(target).toMatchObject({ filePath: "a.js", name: "alpha" });
          f.recovery();
          const recovered = await f.run(true);
          expect(recovered.isReused).toBeUndefined();
          expect(vector(recovered)).toEqual([2,2,0,0,0,0,0,0,0,true]);
        }
      } finally { await f.close(); }
    });
  }

  for (const mode of ["null", "unknown-kind", "unknown-field", "duplicate-path", "duplicate-id", "identity", "missing-entry", "non-dispatched",
    "contradiction", "failed-second-pass", "negative-count", "fractional-count", "count-mismatch", "failed-symbols", "invalid-code", "null-second-pass"] as const) {
    it(`R01 checksum-valid ${mode} capability fresh fallback`, async () => {
      const f = await prepare(sources);
      try {
        await rewriteR01Artifact(f.path, "summary.json", (summary) => {
          const capability = summary.analysisDisposition as { files: Record<string, unknown>[] };
          const first = capability.files[0]!;
          const next = capability.files[1]!;
          switch (mode) {
            case "null": summary.analysisDisposition = null; break;
            case "unknown-kind": first.kind = "unrecognized"; break;
            case "unknown-field": first.invented = true; break;
            case "duplicate-path": next.path = first.path; break;
            case "duplicate-id": next.fileId = first.fileId; break;
            case "identity": first.path = next.path; next.path = "bad.js"; break;
            case "missing-entry": capability.files.pop(); break;
            case "non-dispatched": capability.files.push({ fileId: f.cold.discovery!.files.find((file) => file.path === "package.json")!.id, path: "package.json", kind: "analyzed", symbolCount: 0 }); break;
            case "contradiction": first.code = "FAILURE_ON_SUCCESS"; break;
            case "failed-second-pass": capability.files[0] = { fileId: first.fileId, path: first.path, kind: "initial-parser-failure", code: "FAIL", secondPassFailure: { code: "RESTORE" } }; break;
            case "negative-count": first.symbolCount = -1; break;
            case "fractional-count": first.symbolCount = 0.5; break;
            case "count-mismatch": first.symbolCount = 999; break;
            case "failed-symbols": capability.files[0] = { fileId: first.fileId, path: first.path, kind: "initial-parser-failure", code: "FAIL" }; break;
            case "invalid-code": capability.files[0] = { fileId: first.fileId, path: first.path, kind: "initial-parser-failure", code: "" }; break;
            case "null-second-pass": first.secondPassFailure = null; break;
            // Run-summary contradictions are rejected before projection by the storage oracle.
          }
          return summary;
        });
        expect((await new DiscoveryValidator().validateFreshness(f.path)).status).toBe("VALID");
        const before = f.counts.parser;
        const fresh = await f.run();
        expect(fresh.isReused).toBeUndefined();
        expect(f.counts.parser).toBe(before + 2);
        expect(vector(fresh)).toEqual([3,2,0,0,0,1,0,0,0,true]);
      } finally { await f.close(); }
    });
  }

  for (const artifact of ["knowledge.json", "semantic.json", "control-flow.json", "data-flow.json", "symbols.json", "dependency-graph.json"] as const) {
    it(`R01 rejects missing required current ${artifact} despite a valid reduced manifest`, async () => {
      const f = await prepare(sources);
      try {
        const manifestPath = join(f.path, ".discovery", "manifest.json");
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        manifest.requiredArtifacts = manifest.requiredArtifacts.filter((name: string) => name !== artifact);
        delete manifest.artifacts[artifact];
        await writeFile(manifestPath, JSON.stringify(manifest));
        expect((await new DiscoveryValidator().validateFreshness(f.path)).status).toBe("VALID");
        expect((await f.run()).isReused).toBeUndefined();
      } finally { await f.close(); }
    });
  }

  for (const mode of ["discovery-duplicate-id", "symbols-undiscovered", "symbols-failed", "diagnostics-mismatch", "manifest-count-mismatch", "malformed-knowledge"] as const) {
    it(`R01 checksum-valid ${mode} evidence rejects reuse`, async () => {
      const f = await prepare(mode === "symbols-failed" ? { ...sources, "bad.js": "function broken( {" } : sources);
      try {
        if (mode === "discovery-duplicate-id") {
          const path = join(f.path, ".discovery", "files.json");
          const files = JSON.parse(await readFile(path, "utf8")) as { id: string }[];
          files[1]!.id = files[0]!.id;
          await rewriteR01Artifact(f.path, "files.json", () => files);
        } else if (mode === "symbols-undiscovered" || mode === "symbols-failed") {
          const symbols = JSON.parse(await readFile(join(f.path, ".discovery", "symbols.json"), "utf8")) as { filePath: string }[];
          symbols[0]!.filePath = mode === "symbols-failed" ? "bad.js" : "absent.js";
          await rewriteR01Artifact(f.path, "symbols.json", () => symbols);
        } else if (mode === "malformed-knowledge") {
          await rewriteR01Artifact(f.path, "knowledge.json", () => ({ nodes: [{ id: "invalid" }], edges: [] }));
        } else {
          await rewriteR01Artifact(f.path, "summary.json", (summary) => ({ ...summary, ...(mode === "diagnostics-mismatch" ? { discoveryComplete: false } : { manifestFailureCount: 1 }) }));
        }
        expect((await new DiscoveryValidator().validateFreshness(f.path)).status).toBe("VALID");
        expect((await f.run()).isReused).toBeUndefined();
      } finally { await f.close(); }
    });
  }

  for (const changed of [false, true]) {
    it(`R02 missing digest forces fresh analysis of ${changed ? "same-size changed" : "unchanged"} source`, async () => {
      const original = "export const alpha = 1;\n";
      const replacement = "export const bravo = 1;\n";
      const f = await prepare({ "package.json": '{"name":"r02"}', "index.js": original });
      try {
        const validator = new DiscoveryValidator();
        const before = { ...f.counts };
        const warm = await f.run();
        expect(warm.isReused).toBe(true);
        expect(f.counts).toEqual(before);
        expect(disposition(warm)).toEqual(disposition(f.cold));
        const manifest = (await validator.validate({ projectPath: f.path })).manifest;
        if (!manifest) throw new Error("Missing fixture manifest");
        delete manifest.repository.sourceDigest;
        await writeFile(join(f.path, ".discovery", "manifest.json"), JSON.stringify(manifest));
        const sourcePath = join(f.path, "index.js");
        const timestamp = new Date(1700000000000);
        await utimes(sourcePath, timestamp, timestamp);
        const initialStat = await stat(sourcePath);
        if (changed) {
          expect(Buffer.byteLength(replacement)).toBe(Buffer.byteLength(original));
          expect(createHash("sha256").update(replacement).digest("hex"))
            .not.toBe(createHash("sha256").update(original).digest("hex"));
          await writeFile(sourcePath, replacement);
          await utimes(sourcePath, timestamp, timestamp);
        }
        const currentStat = await stat(sourcePath);
        expect(currentStat.size).toBe(initialStat.size);
        expect(currentStat.mtimeMs).toBe(initialStat.mtimeMs);
        expect((await validator.validate({ projectPath: f.path })).status).toBe("VALID");
        const result = await f.run();
        expect(result.isReused).toBeUndefined();
        expect(f.counts.parser).toBe(before.parser + 1);
        expect(f.counts.extractor).toBe(before.extractor + 1);
        expect(vector(result)).toEqual([2,1,0,0,0,1,0,0,0,true]);
        assertAccounting(result, "PASS");
        const symbols = validateCodeSymbols(result.records.filter((record) => record.type === "symbol-table")
          .flatMap((record) => (record.payload as { symbols: unknown[] }).symbols));
        expect(symbols.map((symbol) => symbol.name)).toEqual(changed ? ["bravo", "bravo"] : ["alpha", "alpha"]);
        expect(disposition(result).files).toHaveLength(1);
      } finally { await f.close(); }
    });
  }

  it("R02 checksum-valid null inventory safely falls back and preserves R01 accounting", async () => {
    const f = await prepare(sources);
    try {
      await rewriteR01Artifact(f.path, "files.json", () => null);
      const before = { ...f.counts };
      const result = await f.run();
      expect(result.isReused).toBeUndefined();
      expect(f.counts.parser).toBe(before.parser + 2);
      expect(f.counts.extractor).toBe(before.extractor + 2);
      expect(vector(result)).toEqual(vector(f.cold));
      expect(disposition(result)).toEqual(disposition(f.cold));
      assertAccounting(result, "PASS");
    } finally { await f.close(); }
  });

  it("R02 repaired on-disk inventory cannot rescue stale checksum-validated bytes during reuse", async () => {
    const f = await prepare(sources);
    const originalScan = FileScanner.prototype.scan;
    try {
      const inventoryPath = join(f.path, ".discovery", "files.json");
      const validRaw = await readFile(inventoryPath, "utf8");
      const inventory = JSON.parse(validRaw) as { path: string; size: number }[];
      const file = inventory.find((entry) => entry.path === "ok.js");
      if (!file) throw new Error("Missing fixture source");
      file.size++;
      await rewriteR01Artifact(f.path, "files.json", () => inventory);
      const before = { ...f.counts };
      let replacements = 0;
      FileScanner.prototype.scan = async function (projectPath) {
        if (projectPath === f.path && replacements === 0) {
          replacements++;
          await writeFile(inventoryPath, validRaw);
        }
        return originalScan.call(this, projectPath);
      };
      const result = await f.run();
      expect(replacements).toBe(1);
      expect(result.isReused).toBeUndefined();
      expect(f.counts.parser).toBe(before.parser + 2);
      expect(f.counts.extractor).toBe(before.extractor + 2);
      expect(vector(result)).toEqual(vector(f.cold));
      expect(disposition(result)).toEqual(disposition(f.cold));
      expect(result.discovery?.files.find((entry) => entry.path === "ok.js")?.size)
        .toBe(Buffer.byteLength(sources["ok.js"]));
    } finally {
      FileScanner.prototype.scan = originalScan;
      await f.close();
    }
  });
});
