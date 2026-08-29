import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { astResultPayloadSchema } from "@contracts/discovery-storage";
import { createEngineContext } from "@runtime/composition/services";
import { MemoryStorageProvider } from "@storage/adapters/memory-storage";
import { SqliteStorageProvider } from "@storage/adapters/sqlite-storage";
import { StorageManager } from "@storage/storage-manager";
import { createStorageRecord } from "@storage/storage-record";

describe("F-01: AST Result Project and Analysis-Run Isolation", () => {
  const projA = "11111111-1111-4111-8111-111111111111";
  const projB = "22222222-2222-4222-8222-222222222222";
  const run1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const run2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  let tempDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "legacy-exodus-ast-iso-"));
    dbPath = join(tempDir, "test.db");
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { force: true, recursive: true });
    } catch {
      // Ignored
    }
  });

  it("validates astResultPayloadSchema contract with run-scoping fields", () => {
    const valid = {
      projectId: projA,
      analysisRunId: run1,
      fileId: "file-1",
      path: "src/app.ts",
      parserId: "javascript-parser",
      nodeCount: 42,
      errorCount: 0,
    };

    const parsed = astResultPayloadSchema.safeParse(valid);
    expect(parsed.success).toBe(true);

    const invalid = {
      ...valid,
      projectId: "not-a-uuid",
    };
    expect(astResultPayloadSchema.safeParse(invalid).success).toBe(false);
  });

  it("Test 1: guarantees analysis-run isolation within the same project", async () => {
    const provider = new MemoryStorageProvider();
    const storage = new StorageManager(provider);

    const astRun1 = createStorageRecord("ast-result", {
      projectId: projA,
      analysisRunId: run1,
      fileId: "f1",
      path: "src/index.ts",
      parserId: "javascript-parser",
      nodeCount: 15,
      errorCount: 0,
    });

    await storage.save(astRun1);

    // Query for Run 2 must NOT receive Run 1's AST result
    const run2Results = await storage.findScoped({
      type: "ast-result",
      projectId: projA,
      analysisRunId: run2,
      filePath: "src/index.ts",
    });

    expect(run2Results).toHaveLength(0);

    // Positive control: Query for Run 1 returns exactly Run 1's AST result
    const run1Results = await storage.findScoped({
      type: "ast-result",
      projectId: projA,
      analysisRunId: run1,
      filePath: "src/index.ts",
    });

    expect(run1Results).toHaveLength(1);
    expect(run1Results[0]!.id).toBe(astRun1.id);
    expect(run1Results[0]!.payload).toMatchObject({
      projectId: projA,
      analysisRunId: run1,
      path: "src/index.ts",
      nodeCount: 15,
    });
  });

  it("Test 2: guarantees project isolation across different projects with same file path", async () => {
    const provider = new MemoryStorageProvider();
    const storage = new StorageManager(provider);

    const astProjA = createStorageRecord("ast-result", {
      projectId: projA,
      analysisRunId: run1,
      fileId: "f1",
      path: "src/common.ts",
      parserId: "javascript-parser",
      nodeCount: 20,
      errorCount: 0,
    });

    await storage.save(astProjA);

    // Query for Project B must NOT receive Project A's AST result
    const projBResults = await storage.findScoped({
      type: "ast-result",
      projectId: projB,
      analysisRunId: run1,
      filePath: "src/common.ts",
    });

    expect(projBResults).toHaveLength(0);
  });

  it("Test 3: SQLite persistence preserves AST result run isolation across restarts", async () => {
    // 1. Initial process: Run 1 stores AST result
    {
      const provider = new SqliteStorageProvider({ databasePath: dbPath });
      const storage = new StorageManager(provider);

      const astRun1 = createStorageRecord("ast-result", {
        projectId: projA,
        analysisRunId: run1,
        fileId: "f1",
        path: "src/db.ts",
        parserId: "javascript-parser",
        nodeCount: 30,
        errorCount: 0,
      });

      await storage.save(astRun1);
      provider.close();
    }

    // 2. Reopen storage in a new instance and query for Run 2 vs Run 1
    {
      const provider = new SqliteStorageProvider({ databasePath: dbPath });
      const storage = new StorageManager(provider);

      // Run 2 query must return empty
      const run2Results = await storage.findScoped({
        type: "ast-result",
        projectId: projA,
        analysisRunId: run2,
        filePath: "src/db.ts",
      });
      expect(run2Results).toHaveLength(0);

      // Run 1 query returns exact persisted record
      const run1Results = await storage.findScoped({
        type: "ast-result",
        projectId: projA,
        analysisRunId: run1,
        filePath: "src/db.ts",
      });
      expect(run1Results).toHaveLength(1);
      expect(run1Results[0]!.payload).toMatchObject({
        projectId: projA,
        analysisRunId: run1,
        path: "src/db.ts",
        nodeCount: 30,
      });

      provider.close();
    }
  });

  it("Test 4: Orchestrator analysis execution produces run-isolated ast-result records", async () => {
    const projectPath = join(tempDir, "workspace");
    const srcDir = join(projectPath, "src");
    await mkdir(srcDir, { recursive: true });

    await writeFile(join(srcDir, "math.ts"), "export const add = (a: number, b: number): number => a + b;", "utf8");
    await writeFile(join(srcDir, "utils.ts"), "export const subtract = (a: number, b: number): number => a - b;", "utf8");

    const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });

    // Execute Run 1
    await context.orchestrator.execute({
      id: run1,
      type: "AnalyzeProject",
      createdAt: new Date(),
      payload: {
        projectId: projA,
        path: projectPath,
      },
    });

    // Verify ast-result records are tagged with projA and run1
    const run1Asts = await context.storage.findScoped({
      type: "ast-result",
      projectId: projA,
      analysisRunId: run1,
    });

    expect(run1Asts).toHaveLength(2);
    for (const record of run1Asts) {
      expect(record.payload).toMatchObject({
        projectId: projA,
        analysisRunId: run1,
      });
    }

    // Scoped query for a different run ID returns zero records
    const run2Asts = await context.storage.findScoped({
      type: "ast-result",
      projectId: projA,
      analysisRunId: run2,
    });

    expect(run2Asts).toHaveLength(0);

    // Scoped query for a different project ID returns zero records
    const projBAsts = await context.storage.findScoped({
      type: "ast-result",
      projectId: projB,
      analysisRunId: run1,
    });

    expect(projBAsts).toHaveLength(0);
  });
});
