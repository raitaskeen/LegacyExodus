import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DiscoveryQueryService } from "@discovery/discovery-query-service";
import { LegacyExodusError } from "@shared/errors";
import { MemoryStorageProvider } from "@storage/adapters/memory-storage";
import { SqliteStorageProvider } from "@storage/adapters/sqlite-storage";
import { DiscoveryProjectionService } from "@storage/projections/discovery-projection-service";
import { FileDiscoveryProjectionAdapter } from "@storage/projections/file-discovery-projection";
import { StorageValidationError } from "@storage/storage-errors";
import { StorageManager } from "@storage/storage-manager";
import { createStorageRecord } from "@storage/storage-record";

describe("P1 Task 8: Schema Drift & Discovery Record Integrity", () => {
  const projectId = "12345678-1234-4234-8234-123456789012";
  const runId1 = "aaaa1111-2222-4333-8444-555566667777";
  const runId2 = "bbbb1111-2222-4333-8444-555566667777";

  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "exodus-schema-drift-test-"));
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Windows lock delay tolerance
    }
  });

  const providers = [
    { name: "MemoryStorageProvider", create: () => new MemoryStorageProvider() },
    { name: "SqliteStorageProvider (in-memory)", create: () => new SqliteStorageProvider({ inMemory: true }) },
  ];

  for (const { name, create } of providers) {
    describe(`${name} Parity`, () => {
      let storage: StorageManager;
      let service: DiscoveryQueryService;

      beforeEach(() => {
        storage = new StorageManager(create());
        service = new DiscoveryQueryService(storage);
      });

      afterEach(() => {
        storage.close();
      });

      // ─── Test A: Valid Records ──────────────────────────────────────────────
      it("Test A: returns valid discovery payload when schema matches", async () => {
        const record = createStorageRecord("project-discovery", {
          projectId,
          analysisRunId: runId1,
          projectName: "sample-project",
          projectPath: "/repo/sample",
          files: [{ id: "f1", path: "src/main.ts", language: "typescript", size: 50 }],
          dependencies: [{ name: "express", version: "4.18.2", kind: "production" as const }],
          frameworks: [{ name: "express", evidence: "package.json" }],
          languages: ["typescript"],
          discoveredAt: new Date().toISOString(),
        });
        await storage.save(record);

        const discovery = await service.getProjectDiscovery(projectId, runId1);
        expect(discovery).not.toBeNull();
        expect(discovery?.projectName).toBe("sample-project");
        expect(discovery?.files).toHaveLength(1);

        const files = await service.getDiscoveredFiles(projectId, runId1);
        expect(files).toHaveLength(1);
        expect(files[0]!.path).toBe("src/main.ts");
      });

      // ─── Test B: Missing Required Field ─────────────────────────────────────
      it("Test B: throws DISCOVERY_RECORD_INVALID when required fields are missing", async () => {
        const recordMissingName = createStorageRecord("project-discovery", {
          projectId,
          analysisRunId: runId1,
          // projectName missing!
          projectPath: "/repo/sample",
          files: [],
          dependencies: [],
          frameworks: [],
          languages: ["typescript"],
          discoveredAt: new Date().toISOString(),
        });
        await storage.save(recordMissingName);

        try {
          await service.getProjectDiscovery(projectId, runId1);
          expect(true).toBe(false); // Should not reach
        } catch (err: unknown) {
          expect(err).toBeInstanceOf(LegacyExodusError);
          expect((err as LegacyExodusError).code).toBe("DISCOVERY_RECORD_INVALID");
        }
      });

      // ─── Test C: Wrong Field Types ──────────────────────────────────────────
      it("Test C: throws DISCOVERY_RECORD_INVALID when field types are invalid", async () => {
        const recordWrongType = createStorageRecord("project-discovery", {
          projectId: "invalid-uuid-format",
          analysisRunId: runId1,
          projectName: "sample-project",
          projectPath: "/repo/sample",
          files: [{ id: "f1", path: "src/main.ts", language: "typescript", size: "not-a-number" as any }],
          dependencies: [],
          frameworks: [],
          languages: ["typescript"],
          discoveredAt: new Date().toISOString(),
        });
        await storage.save(recordWrongType);

        try {
          await service.getProjectDiscovery("invalid-uuid-format", runId1);
          expect(true).toBe(false);
        } catch (err: unknown) {
          expect(err).toBeInstanceOf(LegacyExodusError);
          expect((err as LegacyExodusError).code).toBe("DISCOVERY_RECORD_INVALID");
        }
      });

      // ─── Test D: Symbol Table Schema Drift ──────────────────────────────────
      it("Test D: throws DISCOVERY_RECORD_INVALID when symbol-table contains drifted symbol shapes", async () => {
        const invalidSymbolRecord = createStorageRecord("symbol-table", {
          projectId,
          analysisRunId: runId1,
          path: "src/main.ts",
          symbols: [
            {
              id: "s1",
              // kind missing!
              name: "processHandler",
            },
          ],
        });
        await storage.save(invalidSymbolRecord);

        try {
          await service.getSymbolsForFile(projectId, "src/main.ts", runId1);
          expect(true).toBe(false);
        } catch (err: unknown) {
          expect(err).toBeInstanceOf(LegacyExodusError);
          expect((err as LegacyExodusError).code).toBe("DISCOVERY_RECORD_INVALID");
          expect((err as LegacyExodusError).message).toContain("src/main.ts");
        }
      });

      // ─── Test E: Absent Record Remains Absent (Null / Empty) ────────────────
      it("Test E: returns null or empty array when record is genuinely absent", async () => {
        const absentDiscovery = await service.getProjectDiscovery(projectId, "non-existent-run");
        expect(absentDiscovery).toBeNull();

        const absentFiles = await service.getDiscoveredFiles(projectId, "non-existent-run");
        expect(absentFiles).toHaveLength(0);

        const absentSymbols = await service.getSymbolsForFile(projectId, "src/absent.ts", runId1);
        expect(absentSymbols).toHaveLength(0);

        const absentDep = await service.getDependencyGraph(projectId, runId1);
        expect(absentDep).toBeNull();

        const absentKg = await service.getKnowledgeGraph(projectId, runId1);
        expect(absentKg).toBeNull();

        const absentSem = await service.getSemanticAnalysis(projectId, runId1);
        expect(absentSem).toBeNull();

        const absentCfg = await service.getControlFlowAnalysis(projectId, runId1);
        expect(absentCfg).toBeNull();

        const absentDfg = await service.getDataFlowAnalysis(projectId, runId1);
        expect(absentDfg).toBeNull();
      });

      // ─── Test F: Run Isolation Does Not Mask Contamination ──────────────────
      it("Test F: preserves strict run isolation without cross-run false failures", async () => {
        // Run 1 has a valid record
        const run1Record = createStorageRecord("project-discovery", {
          projectId,
          analysisRunId: runId1,
          projectName: "run-1-project",
          projectPath: "/repo/sample",
          files: [],
          dependencies: [],
          frameworks: [],
          languages: ["typescript"],
          discoveredAt: new Date().toISOString(),
        });
        await storage.save(run1Record);

        // Querying for run 2 returns null (not run 1's record)
        const run2Disc = await service.getProjectDiscovery(projectId, runId2);
        expect(run2Disc).toBeNull();

        // Querying for run 1 returns run 1's record
        const run1Disc = await service.getProjectDiscovery(projectId, runId1);
        expect(run1Disc?.projectName).toBe("run-1-project");
      });
    });
  }

  // ─── Test G: DiscoveryProjectionService Auxiliary Schema Drift ───────────────
  describe("DiscoveryProjectionService Integrity Protection", () => {
    it("throws DISCOVERY_RECORD_INVALID when auxiliary symbol record fails schema validation", async () => {
      const storage = new StorageManager(new MemoryStorageProvider());
      const adapter = new FileDiscoveryProjectionAdapter({ rootDirectory: join(tempDir, ".discovery") });
      const projectionService = new DiscoveryProjectionService(storage, adapter);

      const discoveryRecord = createStorageRecord("project-discovery", {
        projectId,
        analysisRunId: runId1,
        projectName: "projection-test",
        projectPath: tempDir,
        files: [{ id: "f1", path: "src/app.ts", language: "typescript", size: 100 }],
        dependencies: [],
        frameworks: [],
        languages: ["typescript"],
        discoveredAt: new Date().toISOString(),
      });
      await storage.save(discoveryRecord);

      // Save invalid symbol record
      const invalidSymbolRecord = createStorageRecord("symbol-table", {
        projectId,
        analysisRunId: runId1,
        path: "src/app.ts",
        symbols: [{ id: "bad_symbol", missing_name: true }],
      });
      await storage.save(invalidSymbolRecord);

      try {
        await projectionService.project(discoveryRecord.id);
        expect(true).toBe(false);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(LegacyExodusError);
        expect((err as LegacyExodusError).code).toBe("DISCOVERY_RECORD_INVALID");
      }
    });

    it("throws DISCOVERY_RECORD_INVALID when auxiliary dependency-graph record fails schema validation", async () => {
      const storage = new StorageManager(new MemoryStorageProvider());
      const adapter = new FileDiscoveryProjectionAdapter({ rootDirectory: join(tempDir, ".discovery") });
      const projectionService = new DiscoveryProjectionService(storage, adapter);

      const discoveryRecord = createStorageRecord("project-discovery", {
        projectId,
        analysisRunId: runId1,
        projectName: "projection-test",
        projectPath: tempDir,
        files: [{ id: "f1", path: "src/app.ts", language: "typescript", size: 100 }],
        dependencies: [],
        frameworks: [],
        languages: ["typescript"],
        discoveredAt: new Date().toISOString(),
      });
      await storage.save(discoveryRecord);

      // Save invalid dependency graph record (missing edges and cycles)
      const invalidDepRecord = createStorageRecord("dependency-graph", {
        projectId,
        analysisRunId: runId1,
        nodes: "not-an-array" as any,
      });
      await storage.save(invalidDepRecord);

      try {
        await projectionService.project(discoveryRecord.id);
        expect(true).toBe(false);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(LegacyExodusError);
        expect((err as LegacyExodusError).code).toBe("DISCOVERY_RECORD_INVALID");
      }
    });
  });

  // ─── Test H: SQLite Physical Persistence & Reopen Integrity ──────────────────
  describe("SQLite Persistence & Reopen Schema-Drift Safety", () => {
    it("persists invalid record, closes SQLite DB, reopens, and deterministically throws DISCOVERY_RECORD_INVALID", async () => {
      const dbPath = join(tempDir, "drift_test.sqlite");

      // 1. Create and populate persistent SQLite DB
      const provider1 = new SqliteStorageProvider({ databasePath: dbPath });
      const storage1 = new StorageManager(provider1);

      const invalidRecord = createStorageRecord("project-discovery", {
        projectId,
        analysisRunId: runId1,
        // Missing projectName!
        projectPath: "/repo/drift",
        files: [],
        dependencies: [],
        frameworks: [],
        languages: ["typescript"],
        discoveredAt: new Date().toISOString(),
      });
      await storage1.save(invalidRecord);
      storage1.close();

      // 2. Reopen DB from file
      const provider2 = new SqliteStorageProvider({ databasePath: dbPath });
      const storage2 = new StorageManager(provider2);
      const queryService2 = new DiscoveryQueryService(storage2);

      try {
        await queryService2.getProjectDiscovery(projectId, runId1);
        expect(true).toBe(false);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(LegacyExodusError);
        expect((err as LegacyExodusError).code).toBe("DISCOVERY_RECORD_INVALID");
        expect((err as LegacyExodusError).metadata?.recordId).toBe(invalidRecord.id);
      } finally {
        storage2.close();
      }
    });

    it("throws StorageValidationError on physically corrupted SQLite JSON row", async () => {
      const dbPath = join(tempDir, "corrupt_test.sqlite");
      const provider = new SqliteStorageProvider({ databasePath: dbPath });
      const storage = new StorageManager(provider);
      const queryService = new DiscoveryQueryService(storage);

      const rawDb = new Database(dbPath);
      rawDb.run(`
        INSERT INTO storage_records (id, type, project_id, analysis_run_id, file_path, payload, created_at, updated_at)
        VALUES ('1111111111111111111111111111111111111111111111111111111111111111', 'project-discovery', '${projectId}', '${runId1}', NULL, '{malformed_json_payload', 1000, 1000)
      `);
      rawDb.close();

      try {
        await queryService.getProjectDiscovery(projectId, runId1);
        expect(true).toBe(false);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(StorageValidationError);
      } finally {
        storage.close();
      }
    });
  });
});
