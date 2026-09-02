import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { createLegacyExodusEngine } from "@runtime/composition/services";
import { SqliteStorageProvider } from "@storage/adapters/sqlite-storage";
import { StorageManager } from "@storage/storage-manager";
import { DiscoveryQueryService } from "@discovery/discovery-query-service";

describe("Phase 3A P0.4 — Persistent SQLite Cross-Process Reuse", () => {
  let testRepoDir: string;
  let sqliteDbPath: string;

  beforeEach(async () => {
    testRepoDir = join(tmpdir(), `legacy-exodus-sqlite-repo-${randomUUID()}`);
    sqliteDbPath = join(tmpdir(), `legacy-exodus-storage-${randomUUID()}.sqlite`);

    await mkdir(join(testRepoDir, "src"), { recursive: true });

    await writeFile(
      join(testRepoDir, "package.json"),
      JSON.stringify(
        {
          name: "sqlite-persisted-app",
          version: "1.0.0",
          dependencies: {
            lodash: "^4.17.21",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    await writeFile(
      join(testRepoDir, "src", "main.ts"),
      `
      import { get } from "lodash";
      export function fetchUser(data: Record<string, any>) {
        return get(data, "user.name", "anonymous");
      }
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

  it("Process A persists discovery to SQLite; Process B consumes facts via DiscoveryQueryService", async () => {
    const projectId = randomUUID();
    const runId = randomUUID();

    // ─── PROCESS A: Run analysis with SQLite storage driver ────────────
    {
      const engineA = createLegacyExodusEngine({
        LOG_LEVEL: "silent",
        NODE_ENV: "test",
        LEGACY_EXODUS_STORAGE_DRIVER: "sqlite",
        LEGACY_EXODUS_STORAGE_DB_PATH: sqliteDbPath,
      });

      await engineA.initialize();
      try {
        const resultA = await engineA.execute({
          id: runId,
          type: "AnalyzeProject",
          createdAt: new Date(),
          payload: { projectId, path: testRepoDir },
        });

        expect(resultA.type).toBe("AnalyzeProject");
        if (resultA.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject");
        expect(resultA.discovery.projectName).toBe("sqlite-persisted-app");
        expect(resultA.analysis.filesDiscovered).toBeGreaterThanOrEqual(2);
      } finally {
        await engineA.shutdown();
      }
    }

    // ─── PROCESS B: Fresh instance opens same SQLite DB to query discovery ──
    {
      const providerB = new SqliteStorageProvider({ databasePath: sqliteDbPath });
      const storageB = new StorageManager(providerB);
      const queryServiceB = new DiscoveryQueryService(storageB);

      try {
        // 1. Query latest completed run
        const latestRunId = await queryServiceB.getLatestCompletedRunId(projectId);
        expect(latestRunId).toBe(runId);

        // 2. Query project discovery
        const discovery = await queryServiceB.getProjectDiscovery(projectId, runId);
        expect(discovery).not.toBeNull();
        expect(discovery?.projectName).toBe("sqlite-persisted-app");
        expect(discovery?.dependencies).toHaveLength(1);
        expect(discovery?.dependencies[0]?.name).toBe("lodash");

        // 3. Query discovered files
        const files = await queryServiceB.getDiscoveredFiles(projectId, runId);
        expect(files.length).toBeGreaterThanOrEqual(2);
        const mainFile = files.find((f) => f.path.includes("main.ts"));
        expect(mainFile).toBeDefined();

        // 4. Query extracted symbols for file
        if (mainFile) {
          const symbols = await queryServiceB.getSymbolsForFile(projectId, mainFile.path, runId);
          expect(symbols.length).toBeGreaterThanOrEqual(1);
          const fetchUserSymbol = symbols.find((s) => s.name === "fetchUser");
          expect(fetchUserSymbol).toBeDefined();
          expect(fetchUserSymbol?.exported).toBe(true);
        }

        // 5. Query dependency graph
        const depGraph = await queryServiceB.getDependencyGraph(projectId, runId);
        expect(depGraph).not.toBeNull();

        // 6. Project isolation: query for non-existent project returns null / empty
        const foreignProjectId = randomUUID();
        const foreignDiscovery = await queryServiceB.getProjectDiscovery(foreignProjectId);
        expect(foreignDiscovery).toBeNull();
        const foreignFiles = await queryServiceB.getDiscoveredFiles(foreignProjectId);
        expect(foreignFiles).toEqual([]);
      } finally {
        await storageB.close();
      }
    }
  });
});
