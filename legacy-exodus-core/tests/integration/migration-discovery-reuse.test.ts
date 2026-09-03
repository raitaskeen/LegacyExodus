import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { createLegacyExodusEngine } from "@runtime/composition/services";
import { SqliteStorageProvider } from "@storage/adapters/sqlite-storage";
import { StorageManager } from "@storage/storage-manager";
import { DiscoveryQueryService } from "@discovery/discovery-query-service";
import { MigrationFidelityValidator, type PredictionPayload } from "@governance/fidelity/fidelity-validator";
import type { GroundTruthFact } from "@contracts/fidelity";

describe("Phase 3A P0.4 — Migration Discovery Consumption & Reuse", () => {
  let testRepoDir: string;
  let sqliteDbPath: string;

  beforeEach(async () => {
    testRepoDir = join(tmpdir(), `legacy-exodus-migration-test-${randomUUID()}`);
    sqliteDbPath = join(tmpdir(), `legacy-exodus-mig-storage-${randomUUID()}.sqlite`);

    await mkdir(join(testRepoDir, "src"), { recursive: true });

    await writeFile(
      join(testRepoDir, "package.json"),
      JSON.stringify(
        {
          name: "migration-candidate-app",
          version: "3.2.1",
          dependencies: {
            fastify: "^4.20.0",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    await writeFile(
      join(testRepoDir, "src", "server.js"),
      `
      const fastify = require("fastify");
      const app = fastify();
      app.get("/health", (req, reply) => reply.send({ status: "ok" }));
      module.exports = app;
      `,
      "utf8",
    );
  });

  afterEach(async () => {
    try {
      await rm(testRepoDir, { recursive: true, force: true });
    } catch {}
    try {
      await rm(sqliteDbPath, { force: true });
    } catch {}
    try {
      await rm(`${sqliteDbPath}-wal`, { force: true });
    } catch {}
    try {
      await rm(`${sqliteDbPath}-shm`, { force: true });
    } catch {}
  });

  it("Migration downstream consumer queries persistent discovery facts without full rediscovery", async () => {
    const projectId = randomUUID();
    const runId = randomUUID();

    // ─── STAGE 1: Discovery Engine Discovers & Persists ─────────────
    const engine = createLegacyExodusEngine({
      LOG_LEVEL: "silent",
      NODE_ENV: "test",
      LEGACY_EXODUS_STORAGE_DRIVER: "sqlite",
      LEGACY_EXODUS_STORAGE_DB_PATH: sqliteDbPath,
    });

    await engine.initialize();
    try {
      const discoveryResult = await engine.execute({
        id: runId,
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId, path: testRepoDir },
      });
      expect(discoveryResult.type).toBe("AnalyzeProject");
    } finally {
      await engine.shutdown();
    }

    // ─── STAGE 2: Migration Consumer Reuses Persisted Discovery ───────
    // A fresh migration process connects to the SQLite database
    const provider = new SqliteStorageProvider({ databasePath: sqliteDbPath });
    const storage = new StorageManager(provider);
    const queryService = new DiscoveryQueryService(storage);

    try {
      // Migration consumer reads only the facts it needs:
      const files = await queryService.getDiscoveredFiles(projectId, runId);
      const discovery = await queryService.getProjectDiscovery(projectId, runId);
      const depGraph = await queryService.getDependencyGraph(projectId, runId);

      expect(depGraph).not.toBeNull();
      expect(files.length).toBeGreaterThanOrEqual(2);
      expect(discovery?.projectName).toBe("migration-candidate-app");
      expect(discovery?.dependencies[0]?.name).toBe("fastify");

      // Extract symbols for files
      type DiscoveredSymbol = Awaited<ReturnType<DiscoveryQueryService["getSymbolsForFile"]>>[number];
      const symbols: DiscoveredSymbol[] = [];
      for (const file of files) {
        const fileSymbols = await queryService.getSymbolsForFile(projectId, file.path, runId);
        symbols.push(...fileSymbols);
      }

      // Feed into MigrationFidelityValidator
      const predictions: PredictionPayload = {
        files: files.map((f) => ({ path: f.path, language: f.language })),
        dependencies: (discovery?.dependencies ?? []).map((d) => ({
          name: d.name,
          version: d.version,
          kind: d.kind,
        })),
        symbols: symbols.map((s) => ({ filePath: s.filePath, name: s.name, kind: s.kind, exported: s.exported })),
      };

      const groundTruth: readonly GroundTruthFact[] = [
        {
          id: "gt-mig-1",
          category: "file",
          attributes: { path: "src/server.js", language: "javascript" },
          provenance: "GROUND_TRUTH_SOURCE",
          sourceDescription: "Fastify server entry point",
          migrationRelevance: "Server entry point for migration to Next/Fastify v5",
        },
        {
          id: "gt-mig-2",
          category: "dependency",
          attributes: { name: "fastify", version: "^4.20.0", kind: "production" },
          provenance: "GROUND_TRUTH_SOURCE",
          sourceDescription: "Core web framework dependency",
          migrationRelevance: "Framework migration target",
        },
      ];

      const validator = new MigrationFidelityValidator();
      const report = validator.validate(groundTruth, predictions, {
        targetName: "migration-candidate-app",
        isSampleBased: false,
        categoryScopes: { file: "CLOSED_WORLD", dependency: "CLOSED_WORLD" },
      });

      expect(report.overallPrecision).toBeGreaterThan(0);
      expect(report.overallRecall).toBe(1.0);
      expect(report.overallTruePositives).toBe(2);
      expect(report.overallFalseNegatives).toBe(0);
    } finally {
      await storage.close();
    }
  });
});
