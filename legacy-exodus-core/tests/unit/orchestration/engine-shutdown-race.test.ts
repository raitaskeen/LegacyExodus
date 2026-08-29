import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEngineContext } from "@runtime/composition/services";
import { LegacyExodusEngine } from "@core/engine/engine";
import type { Parser, ParseRequest, ParseResponse } from "@parser/index";
import { SqliteStorageProvider } from "@storage/adapters/sqlite-storage";
import { StorageManager } from "@storage/storage-manager";
import { createStorageRecord } from "@storage/storage-record";

class ControllablePausingParser implements Parser {
  public readonly id = "pausing-parser";
  public readonly name = "Pausing Parser";
  public readonly version = "1.0.0";
  public readonly supportedLanguages = Object.freeze(["javascript", "typescript"]);
  public readonly capabilities = Object.freeze(["ast", "comments", "exports", "imports", "locations"] as const);

  public constructor(private readonly pauseMs: number = 60) {}

  public canHandle(_request: ParseRequest): boolean {
    return true;
  }

  public async parse(request: ParseRequest): Promise<ParseResponse> {
    await new Promise((resolve) => setTimeout(resolve, this.pauseMs));
    return {
      result: {
        metadata: {
          parserId: this.id,
          language: request.file.language,
          sourcePath: request.file.path,
        },
        root: {
          type: "Program",
          attributes: {},
          children: [
            {
              type: "ExportNamedDeclaration",
              attributes: {},
              children: [
                {
                  type: "VariableDeclaration",
                  attributes: { kind: "const" },
                  children: [
                    {
                      type: "VariableDeclarator",
                      attributes: { name: "val" },
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
        statistics: { durationMs: 1, nodeCount: 4 },
        warnings: [],
        errors: [],
      },
    };
  }
}

describe("F-004 / F-005 / F-006: In-Flight Analysis vs Engine & Runtime Shutdown Lifecycle Contract", () => {
  it("1. in-flight analysis is gracefully drained before storage shutdown, preventing closed database errors (Case 1 & 2)", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "legacy-exodus-race-p1-"));
    const dbDir = await mkdtemp(join(tmpdir(), "legacy-exodus-race-db1-"));
    const dbPath = join(dbDir, "race.sqlite");

    try {
      for (let i = 0; i < 5; i++) {
        await writeFile(join(projectDir, `file_${i}.js`), `export const val_${i} = ${i};`, "utf8");
      }

      const context = createEngineContext({
        LOG_LEVEL: "silent",
        NODE_ENV: "test",
        LEGACY_EXODUS_STORAGE_DRIVER: "sqlite",
        LEGACY_EXODUS_STORAGE_DB_PATH: dbPath,
      });

      context.parserRegistry.unregister("javascript-parser");
      context.parserRegistry.register(new ControllablePausingParser(80));

      const engine = new LegacyExodusEngine(context);
      await engine.initialize();

      const analyzeCommand = {
        id: "00000000-0000-4000-8000-000000000010",
        type: "AnalyzeProject" as const,
        createdAt: new Date(),
        payload: {
          projectId: "00000000-0000-4000-8000-000000000020",
          path: projectDir,
        },
      };

      const execPromise = engine.execute(analyzeCommand);

      await new Promise((resolve) => setTimeout(resolve, 20));
      const shutdownPromise = engine.shutdown();

      const [execResult, shutdownResult] = await Promise.allSettled([execPromise, shutdownPromise]);

      expect(execResult.status).toBe("fulfilled");
      expect(shutdownResult.status).toBe("fulfilled");

      expect(engine.status().state).toBe("stopped");
      expect(context.runtime.getStatus()).toBe("stopped");

      const verifyProvider = new SqliteStorageProvider({ databasePath: dbPath });
      const verifyStorage = new StorageManager(verifyProvider);
      const discoveries = await verifyStorage.findAll("project-discovery");
      const symbols = await verifyStorage.findAll("symbol-table");
      const flowRecords = await verifyStorage.findAll("control-flow-analysis");
      expect(discoveries).toHaveLength(1);
      expect(symbols.length).toBeGreaterThan(0);
      expect(flowRecords).toHaveLength(1);
      verifyProvider.close();

      const manifestRaw = await readFile(join(projectDir, ".discovery", "manifest.json"), "utf8");
      const manifest = JSON.parse(manifestRaw);
      expect(manifest.analysis.analysisRunId).toBe("00000000-0000-4000-8000-000000000010");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
      await rm(dbDir, { recursive: true, force: true });
    }
  });

  it("2. new commands are rejected with ENGINE_NOT_RUNNING once engine shutdown has initiated (Case 2 boundary)", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "legacy-exodus-race-p2-"));
    const dbDir = await mkdtemp(join(tmpdir(), "legacy-exodus-race-db2-"));
    const dbPath = join(dbDir, "race.sqlite");

    try {
      await writeFile(join(projectDir, "test.js"), "export const x = 1;", "utf8");

      const context = createEngineContext({
        LOG_LEVEL: "silent",
        NODE_ENV: "test",
        LEGACY_EXODUS_STORAGE_DRIVER: "sqlite",
        LEGACY_EXODUS_STORAGE_DB_PATH: dbPath,
      });

      context.parserRegistry.unregister("javascript-parser");
      context.parserRegistry.register(new ControllablePausingParser(100));

      const engine = new LegacyExodusEngine(context);
      await engine.initialize();

      const cmd1 = {
        id: "00000000-0000-4000-8000-000000000001",
        type: "AnalyzeProject" as const,
        createdAt: new Date(),
        payload: { projectId: "00000000-0000-4000-8000-000000000002", path: projectDir },
      };

      const cmd2 = {
        id: "00000000-0000-4000-8000-000000000003",
        type: "AnalyzeProject" as const,
        createdAt: new Date(),
        payload: { projectId: "00000000-0000-4000-8000-000000000004", path: projectDir },
      };

      const p1 = engine.execute(cmd1);
      await new Promise((resolve) => setTimeout(resolve, 20));

      const shutdownPromise = engine.shutdown();

      await expect(engine.execute(cmd2)).rejects.toThrow(
        expect.objectContaining({ code: "ENGINE_NOT_RUNNING" }),
      );

      await Promise.all([p1, shutdownPromise]);
      expect(engine.status().state).toBe("stopped");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
      await rm(dbDir, { recursive: true, force: true });
    }
  });

  it("3. orchestrator stop gracefully waits for active execution when invoked directly via runtime (Case 3)", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "legacy-exodus-race-p3-"));
    const dbDir = await mkdtemp(join(tmpdir(), "legacy-exodus-race-db3-"));
    const dbPath = join(dbDir, "race.sqlite");

    try {
      await writeFile(join(projectDir, "main.js"), "export const a = 1;", "utf8");

      const context = createEngineContext({
        LOG_LEVEL: "silent",
        NODE_ENV: "test",
        LEGACY_EXODUS_STORAGE_DRIVER: "sqlite",
        LEGACY_EXODUS_STORAGE_DB_PATH: dbPath,
      });

      context.parserRegistry.unregister("javascript-parser");
      context.parserRegistry.register(new ControllablePausingParser(80));

      await context.runtime.start();
      expect(context.runtime.getStatus()).toBe("running");

      const cmd = {
        id: "00000000-0000-4000-8000-000000000050",
        type: "AnalyzeProject" as const,
        createdAt: new Date(),
        payload: { projectId: "00000000-0000-4000-8000-000000000060", path: projectDir },
      };

      const orchPromise = context.orchestrator.execute(cmd);
      await new Promise((resolve) => setTimeout(resolve, 20));

      const runtimeShutdownPromise = context.runtime.shutdown();

      const [orchResult, runtimeResult] = await Promise.allSettled([orchPromise, runtimeShutdownPromise]);

      expect(orchResult.status).toBe("fulfilled");
      expect(runtimeResult.status).toBe("fulfilled");
      expect(context.runtime.getStatus()).toBe("stopped");
      expect(context.orchestrator.getStatus()).toBe("stopped");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
      await rm(dbDir, { recursive: true, force: true });
    }
  });

  it("4. discovery projection service stop gracefully waits for in-flight project() calls and directory queue (Case 4 & 5)", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "legacy-exodus-race-p4-"));
    const dbDir = await mkdtemp(join(tmpdir(), "legacy-exodus-race-db4-"));
    const dbPath = join(dbDir, "race.sqlite");

    try {
      const context = createEngineContext({
        LOG_LEVEL: "silent",
        NODE_ENV: "test",
        LEGACY_EXODUS_STORAGE_DRIVER: "sqlite",
        LEGACY_EXODUS_STORAGE_DB_PATH: dbPath,
      });

      await context.runtime.start();
      expect(context.runtime.getStatus()).toBe("running");

      const projectId = "00000000-0000-4000-8000-000000000200";

      const record = createStorageRecord("project-discovery", {
        projectId,
        projectName: "Sample Project",
        projectPath: projectDir,
        languages: ["javascript"],
        files: [{ id: "f1", path: "app.js", language: "javascript", size: 100 }],
        dependencies: [],
        frameworks: [],
        discoveredAt: new Date().toISOString(),
      });

      await context.storage.save(record);

      // Launch project() concurrently and trigger runtime shutdown
      const projectPromise = context.discoveryProjection.project(record.id);
      const runtimeShutdownPromise = context.runtime.shutdown();

      const [projResult, runtimeResult] = await Promise.allSettled([projectPromise, runtimeShutdownPromise]);

      expect(projResult.status).toBe("fulfilled");
      expect(runtimeResult.status).toBe("fulfilled");
      expect(context.runtime.getStatus()).toBe("stopped");

      // Verify files were fully written to disk before shutdown
      const manifestRaw = await readFile(join(projectDir, ".discovery", "manifest.json"), "utf8");
      const manifest = JSON.parse(manifestRaw);
      expect(manifest.repository.name).toBe("Sample Project");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
      await rm(dbDir, { recursive: true, force: true });
    }
  });

  it("5. projection failure during execution does not poison runtime cleanup or leave unhandled rejection (Case 6 & 7)", async () => {
    const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    await context.runtime.start();

    // project() with non-existent ID throws DISCOVERY_RECORD_NOT_FOUND
    const badProj = context.discoveryProjection.project("00000000-0000-4000-8000-000000000999");
    const shutdownP = context.runtime.shutdown();

    const [projRes, shutRes] = await Promise.allSettled([badProj, shutdownP]);

    expect(projRes.status).toBe("rejected");
    expect(shutRes.status).toBe("fulfilled");
    expect(context.runtime.getStatus()).toBe("stopped");
  });

  it("6. projection service rejects new requests once stopped (Case 7 boundary)", async () => {
    const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    await context.runtime.start();
    await context.runtime.shutdown();

    expect(context.runtime.getStatus()).toBe("stopped");
    await expect(context.discoveryProjection.project("00000000-0000-4000-8000-000000000001")).rejects.toThrow(
      expect.objectContaining({ code: "PROJECTION_SERVICE_STOPPED" }),
    );
  });

  it("7. repeated concurrent analysis vs shutdown stress (100 runs) executes deterministically without error (Case 8)", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "legacy-exodus-race-stress-"));
    const dbDir = await mkdtemp(join(tmpdir(), "legacy-exodus-race-db-stress-"));

    try {
      await writeFile(join(projectDir, "test.js"), "export const x = 100;", "utf8");

      for (let run = 1; run <= 100; run++) {
        const dbPath = join(dbDir, `stress_${run}.sqlite`);
        const context = createEngineContext({
          LOG_LEVEL: "silent",
          NODE_ENV: "test",
          LEGACY_EXODUS_STORAGE_DRIVER: "sqlite",
          LEGACY_EXODUS_STORAGE_DB_PATH: dbPath,
        });

        const engine = new LegacyExodusEngine(context);
        await engine.initialize();

        const cmd = {
          id: `00000000-0000-4000-8000-${String(run).padStart(12, "0")}`,
          type: "AnalyzeProject" as const,
          createdAt: new Date(),
          payload: { projectId: "00000000-0000-4000-8000-000000000001", path: projectDir },
        };

        const execP = engine.execute(cmd);
        const shutdownP = engine.shutdown();

        const [r1, r2] = await Promise.allSettled([execP, shutdownP]);
        expect(r1.status).toBe("fulfilled");
        expect(r2.status).toBe("fulfilled");
        expect(engine.status().state).toBe("stopped");
      }
    } finally {
      await rm(projectDir, { recursive: true, force: true });
      await rm(dbDir, { recursive: true, force: true });
    }
  }, 60000);
});
