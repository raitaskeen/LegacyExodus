import { beforeEach, describe, expect, it } from "bun:test";
import { DiscoveryQueryService } from "@discovery/discovery-query-service";
import { MemoryStorageProvider } from "@storage/adapters/memory-storage";
import { SqliteStorageProvider } from "@storage/adapters/sqlite-storage";
import { StorageManager } from "@storage/storage-manager";
import { createStorageRecord } from "@storage/storage-record";
import { Orchestrator } from "@core/orchestration/orchestrator";
import { InMemoryEventStore } from "@core/events/event-store";
import { EventBus } from "@core/events/event-bus";
import { createProjectState } from "@core/state/state-factory";
import { DiscoveryEngine } from "@discovery/discovery-engine";
import { JavaScriptParser, ParserManager, ParserRegistry } from "@parser/index";
import { JavaScriptSymbolExtractor } from "@symbols/index";
import { join } from "node:path";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { unlinkSync, existsSync } from "node:fs";

describe("Analysis-Run Atomicity & Completion Semantics (F-004)", () => {
  let storage: StorageManager;
  let queryService: DiscoveryQueryService;

  const projectId = "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d";
  const run1Id = "11111111-1111-4111-8111-111111111111";
  const run2Id = "22222222-2222-4222-8222-222222222222";
  const dbPath = join(import.meta.dir, "../../fixtures/scratch-atomicity-eval.sqlite");

  function cleanupSqlite() {
    try {
      if (existsSync(dbPath)) unlinkSync(dbPath);
      if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
      if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
    } catch {
      // Ignore Windows file lock delay
    }
  }

  beforeEach(() => {
    storage = new StorageManager(new MemoryStorageProvider());
    queryService = new DiscoveryQueryService(storage);
  });

  it("1. successful run becomes consumable only after completion", async () => {
    // Stage 1: Incomplete run with only project-discovery saved (no completed analysis-run record)
    await storage.save(
      createStorageRecord("project-discovery", {
        projectId,
        analysisRunId: run1Id,
        projectName: "test-app",
        projectPath: "/repo/test-app",
        files: [{ id: "f1", path: "src/index.ts", language: "typescript", size: 100 }],
        dependencies: [],
        frameworks: [],
        languages: ["typescript"],
        discoveredAt: new Date().toISOString(),
      }),
    );

    await storage.save(
      createStorageRecord("analysis-run", {
        projectId,
        analysisRunId: run1Id,
        status: "running",
        startedAt: new Date().toISOString(),
      }),
    );

    // Unspecified run query should not find a completed run
    const completedRunId = await queryService.getLatestCompletedRunId(projectId);
    expect(completedRunId).toBeNull();

    // Querying project discovery without runId returns null since run is not completed
    const discovery = await queryService.getProjectDiscovery(projectId);
    expect(discovery).toBeNull();

    // Now mark run as completed
    await storage.save(
      createStorageRecord("analysis-run", {
        projectId,
        analysisRunId: run1Id,
        status: "completed",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        summary: {
          filesDiscovered: 1,
          filesAnalyzed: 1,
          parserFailures: 0,
          symbolExtractionFailures: 0,
          unsupportedFiles: 0,
          nonSourceArtifacts: 0,
          unclassifiedArtifacts: 0,
          durationMs: 15,
        },
      }),
    );

    const activeRunId = await queryService.getLatestCompletedRunId(projectId);
    expect(activeRunId).toBe(run1Id);

    const completedDiscovery = await queryService.getProjectDiscovery(projectId);
    expect(completedDiscovery).not.toBeNull();
    expect(completedDiscovery?.analysisRunId).toBe(run1Id);
  });

  it("2. failed/incomplete run is not treated as completed", async () => {
    // Record a failed run
    await storage.save(
      createStorageRecord("analysis-run", {
        projectId,
        analysisRunId: run1Id,
        status: "failed",
        startedAt: new Date().toISOString(),
        error: "Fatal AST parser failure on corrupted syntax",
      }),
    );

    await storage.save(
      createStorageRecord("project-discovery", {
        projectId,
        analysisRunId: run1Id,
        projectName: "test-app",
        projectPath: "/repo/test-app",
        files: [{ id: "f1", path: "src/broken.ts", language: "typescript", size: 100 }],
        dependencies: [],
        frameworks: [],
        languages: ["typescript"],
        discoveredAt: new Date().toISOString(),
      }),
    );

    const completedRunId = await queryService.getLatestCompletedRunId(projectId);
    expect(completedRunId).toBeNull();

    const discovery = await queryService.getProjectDiscovery(projectId);
    expect(discovery).toBeNull();

    const runs = await queryService.listAnalysisRuns(projectId);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("failed");
    expect(runs[0]?.error).toBe("Fatal AST parser failure on corrupted syntax");
  });

  it("3. stale previous-run data is not exposed as current completed data and runs do not cross-contaminate", async () => {
    // Run 1 completed fully
    await storage.save(
      createStorageRecord("analysis-run", {
        projectId,
        analysisRunId: run1Id,
        status: "completed",
        startedAt: new Date(Date.now() - 10000).toISOString(),
        completedAt: new Date(Date.now() - 9000).toISOString(),
      }),
    );

    await storage.save(
      createStorageRecord("project-discovery", {
        projectId,
        analysisRunId: run1Id,
        projectName: "app-v1",
        projectPath: "/repo/app",
        files: [{ id: "f1", path: "src/index.ts", language: "typescript", size: 100 }],
        dependencies: [],
        frameworks: [],
        languages: ["typescript"],
        discoveredAt: new Date(Date.now() - 10000).toISOString(),
      }),
    );

    await storage.save(
      createStorageRecord("dependency-graph", {
        projectId,
        analysisRunId: run1Id,
        nodes: [{ id: "n1", filePath: "src/index.ts", symbolId: "s1" }],
        edges: [],
        cycles: [],
      }),
    );

    // Run 2 starts, writes partial discovery, but fails before dependency-graph
    await storage.save(
      createStorageRecord("analysis-run", {
        projectId,
        analysisRunId: run2Id,
        status: "failed",
        startedAt: new Date().toISOString(),
        error: "Dependency resolution failure",
      }),
    );

    await storage.save(
      createStorageRecord("project-discovery", {
        projectId,
        analysisRunId: run2Id,
        projectName: "app-v2",
        projectPath: "/repo/app",
        files: [
          { id: "f1", path: "src/index.ts", language: "typescript", size: 100 },
          { id: "f2", path: "src/app.ts", language: "typescript", size: 200 },
        ],
        dependencies: [],
        frameworks: [],
        languages: ["typescript"],
        discoveredAt: new Date().toISOString(),
      }),
    );

    // When querying without runId, queryService must consistently return completed Run 1 data
    const discovery = await queryService.getProjectDiscovery(projectId);
    const depGraph = await queryService.getDependencyGraph(projectId);

    expect(discovery?.analysisRunId).toBe(run1Id);
    expect(discovery?.projectName).toBe("app-v1");
    expect(discovery?.files).toHaveLength(1);

    expect(depGraph?.analysisRunId).toBe(run1Id);
    expect(depGraph?.nodes).toHaveLength(1);
    expect(depGraph?.nodes[0]?.filePath).toBe("src/index.ts");
  });

  it("4. repeated runs remain isolated without symbol concatenation", async () => {
    // Run 1: index.ts had symbol 'foo'
    await storage.save(
      createStorageRecord("analysis-run", {
        projectId,
        analysisRunId: run1Id,
        status: "completed",
        startedAt: new Date(Date.now() - 10000).toISOString(),
        completedAt: new Date(Date.now() - 9000).toISOString(),
      }),
    );

    await storage.save(
      createStorageRecord("symbol-table", {
        projectId,
        analysisRunId: run1Id,
        fileId: "f1",
        path: "src/index.ts",
        symbols: [
          {
            id: "s1",
            kind: "function",
            name: "foo",
            filePath: "src/index.ts",
            language: "typescript",
            exported: true,
            defaultExport: false,
            async: false,
            anonymous: false,
            visibility: "public",
            parameters: [],
          },
        ],
      }),
    );

    // Run 2: index.ts was modified and now has symbol 'bar'
    await storage.save(
      createStorageRecord("analysis-run", {
        projectId,
        analysisRunId: run2Id,
        status: "completed",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      }),
    );

    await storage.save(
      createStorageRecord("symbol-table", {
        projectId,
        analysisRunId: run2Id,
        fileId: "f1_v2",
        path: "src/index.ts",
        symbols: [
          {
            id: "s2",
            kind: "function",
            name: "bar",
            filePath: "src/index.ts",
            language: "typescript",
            exported: true,
            defaultExport: false,
            async: false,
            anonymous: false,
            visibility: "public",
            parameters: [],
          },
        ],
      }),
    );

    // Querying without runId resolves to latest completed run (Run 2)
    const latestSymbols = await queryService.getSymbolsForFile(projectId, "src/index.ts");
    expect(latestSymbols).toHaveLength(1);
    expect(latestSymbols[0]?.name).toBe("bar");

    // Explicit Run 1 query returns Run 1 symbol
    const run1Symbols = await queryService.getSymbolsForFile(projectId, "src/index.ts", run1Id);
    expect(run1Symbols).toHaveLength(1);
    expect(run1Symbols[0]?.name).toBe("foo");

    // Explicit Run 2 query returns Run 2 symbol
    const run2Symbols = await queryService.getSymbolsForFile(projectId, "src/index.ts", run2Id);
    expect(run2Symbols).toHaveLength(1);
    expect(run2Symbols[0]?.name).toBe("bar");
  });

  it("5. orchestrator executes full analysis and emits completed analysis-run record and events via saveBatch", async () => {
    const testDir = join(import.meta.dir, "../../fixtures/scratch-atomicity-test");
    await mkdir(testDir, { recursive: true });
    await writeFile(
      join(testDir, "index.js"),
      "function calculateTotal(items) { return items.reduce((a, b) => a + b, 0); }\nmodule.exports = { calculateTotal };\n",
    );

    try {
      const eventStore = new InMemoryEventStore();
      const eventBus = new EventBus();
      const parserRegistry = new ParserRegistry();
      parserRegistry.register(new JavaScriptParser());
      const orchestrator = new Orchestrator(
        eventStore,
        eventBus,
        storage,
        new DiscoveryEngine(),
        createProjectState("Atomicity Test"),
        new ParserManager(parserRegistry),
        new JavaScriptSymbolExtractor(),
      );

      const command = {
        id: run1Id,
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: {
          projectId,
          path: testDir,
        },
      };

      const execution = await orchestrator.execute(command);
      expect(execution.records.some((r) => r.type === "analysis-run")).toBe(true);

      const analysisRunRecord = execution.records.find((r) => r.type === "analysis-run");
      expect(analysisRunRecord).toBeDefined();

      const runPayload = (analysisRunRecord?.payload as any);
      expect(runPayload.status).toBe("completed");
      expect(runPayload.analysisRunId).toBe(run1Id);
      expect(runPayload.projectId).toBe(projectId);
      expect(runPayload.summary.filesDiscovered).toBeGreaterThan(0);

      // Verify domain events
      const events = eventStore.getAll();
      expect(events.some((e) => e.type === "AnalysisRunCompleted")).toBe(true);

      // Verify query service can query the completed run
      const disc = await queryService.getProjectDiscovery(projectId);
      expect(disc).not.toBeNull();
      expect(disc?.analysisRunId).toBe(run1Id);

      const run = await queryService.getAnalysisRun(projectId, run1Id);
      expect(run).not.toBeNull();
      expect(run?.status).toBe("completed");
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("6. SQLite saveBatch rolls back completely when an error occurs during transaction", async () => {
    cleanupSqlite();
    const provider = new SqliteStorageProvider({ databasePath: dbPath });
    const sqliteStorage = new StorageManager(provider);

    const validRecord = createStorageRecord("project-discovery", {
      projectId,
      analysisRunId: run1Id,
      projectName: "app",
      projectPath: "/repo/app",
      files: [{ id: "f1", path: "src/index.ts", language: "typescript", size: 100 }],
      dependencies: [],
      frameworks: [],
      languages: ["typescript"],
      discoveredAt: new Date().toISOString(),
    });

    const brokenRecord = {
      id: "broken-rec",
      type: "invalid-payload-rec",
      payload: { [Symbol("cannotSerialize")]: "oops" }, // Circular/unserializable payload that throws in JSON.stringify
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any;

    try {
      expect(async () => {
        await sqliteStorage.saveBatch([validRecord, brokenRecord]);
      }).toThrow();

      // Ensure that validRecord was rolled back and NOT saved to SQLite
      const found = await sqliteStorage.findScoped({ type: "project-discovery", projectId, analysisRunId: run1Id });
      expect(found).toHaveLength(0);
    } finally {
      provider.close();
      try {
        cleanupSqlite();
      } catch {
        // Ignore lock delay
      }
    }
  });

  it("7. SQLite restart after failed run guarantees completion gating and run isolation", async () => {
    cleanupSqlite();

    // 1. Initial process: Run 1 completes fully
    {
      const provider = new SqliteStorageProvider({ databasePath: dbPath });
      const persistentStorage = new StorageManager(provider);

      await persistentStorage.saveBatch([
        createStorageRecord("project-discovery", {
          projectId,
          analysisRunId: run1Id,
          projectName: "app",
          projectPath: "/repo/app",
          files: [{ id: "f1", path: "src/index.ts", language: "typescript", size: 100 }],
          dependencies: [],
          frameworks: [],
          languages: ["typescript"],
          discoveredAt: new Date(Date.now() - 10000).toISOString(),
        }),
        createStorageRecord("symbol-table", {
          projectId,
          analysisRunId: run1Id,
          fileId: "f1",
          path: "src/index.ts",
          symbols: [{ id: "s1", kind: "function", name: "v1Func", filePath: "src/index.ts", language: "typescript", exported: true, defaultExport: false, async: false, anonymous: false, visibility: "public", parameters: [] }],
        }),
        createStorageRecord("analysis-run", {
          projectId,
          analysisRunId: run1Id,
          status: "completed",
          startedAt: new Date(Date.now() - 10000).toISOString(),
          completedAt: new Date(Date.now() - 9000).toISOString(),
        }),
      ]);

      provider.close();
    }

    // 2. Second process: Run 2 starts, writes partial records individually, then crashes before analysis-run record
    {
      const provider = new SqliteStorageProvider({ databasePath: dbPath });
      const persistentStorage = new StorageManager(provider);

      await persistentStorage.save(createStorageRecord("project-discovery", {
        projectId,
        analysisRunId: run2Id,
        projectName: "app-v2",
        projectPath: "/repo/app",
        files: [
          { id: "f1", path: "src/index.ts", language: "typescript", size: 100 },
          { id: "f2", path: "src/new.ts", language: "typescript", size: 200 },
        ],
        dependencies: [],
        frameworks: [],
        languages: ["typescript"],
        discoveredAt: new Date().toISOString(),
      }));

      await persistentStorage.save(createStorageRecord("symbol-table", {
        projectId,
        analysisRunId: run2Id,
        fileId: "f1",
        path: "src/index.ts",
        symbols: [{ id: "s2", kind: "function", name: "v2Func", filePath: "src/index.ts", language: "typescript", exported: true, defaultExport: false, async: false, anonymous: false, visibility: "public", parameters: [] }],
      }));

      // Crash / exit before writing analysis-run record
      provider.close();
    }

    // 3. Third process: Application reopens and queries state
    {
      const provider = new SqliteStorageProvider({ databasePath: dbPath });
      const persistentStorage = new StorageManager(provider);
      const persistentQueryService = new DiscoveryQueryService(persistentStorage);

      // Raw un-gated check: partial records physically exist on disk
      const rawRun2Discovery = await persistentStorage.findScoped({ type: "project-discovery", projectId, analysisRunId: run2Id });
      expect(rawRun2Discovery).toHaveLength(1);

      // Domain query service check: completion gating isolates reads to completed Run 1
      const latestCompletedRun = await persistentQueryService.getLatestCompletedRunId(projectId);
      expect(latestCompletedRun).toBe(run1Id);

      const activeDiscovery = await persistentQueryService.getProjectDiscovery(projectId);
      expect(activeDiscovery?.analysisRunId).toBe(run1Id);
      expect(activeDiscovery?.projectName).toBe("app");
      expect(activeDiscovery?.files).toHaveLength(1);

      const activeSymbols = await persistentQueryService.getSymbolsForFile(projectId, "src/index.ts");
      expect(activeSymbols).toHaveLength(1);
      expect(activeSymbols[0]?.name).toBe("v1Func");

      provider.close();
    }

    try {
      cleanupSqlite();
    } catch {
      // Ignore lock delay
    }
  });

  it("8. uncompleted or crashed run partial state is never exposed by DiscoveryQueryService", async () => {
    cleanupSqlite();

    // 1. Initial setup: Run 1 completes fully
    {
      const provider = new SqliteStorageProvider({ databasePath: dbPath });
      const persistentStorage = new StorageManager(provider);

      await persistentStorage.saveBatch([
        createStorageRecord("project-discovery", {
          projectId,
          analysisRunId: run1Id,
          projectName: "app",
          projectPath: "/repo/app",
          files: [{ id: "f1", path: "src/index.ts", language: "typescript", size: 100 }],
          dependencies: [],
          frameworks: [],
          languages: ["typescript"],
          discoveredAt: new Date(Date.now() - 10000).toISOString(),
        }),
        createStorageRecord("symbol-table", {
          projectId,
          analysisRunId: run1Id,
          fileId: "f1",
          path: "src/index.ts",
          symbols: [{ id: "s1", kind: "function", name: "v1Func", filePath: "src/index.ts", language: "typescript", exported: true, defaultExport: false, async: false, anonymous: false, visibility: "public", parameters: [] }],
        }),
        createStorageRecord("analysis-run", {
          projectId,
          analysisRunId: run1Id,
          status: "completed",
          startedAt: new Date(Date.now() - 10000).toISOString(),
          completedAt: new Date(Date.now() - 9000).toISOString(),
        }),
      ]);

      provider.close();
    }

    // 2. Simulate crashed run: Run 2 wrote partial discovery & symbol records but crashed before completion record
    {
      const provider = new SqliteStorageProvider({ databasePath: dbPath });
      const persistentStorage = new StorageManager(provider);

      // Writes uncompleted run records (e.g. from interrupted stage or partial crash)
      await persistentStorage.save(
        createStorageRecord("project-discovery", {
          projectId,
          analysisRunId: run2Id,
          projectName: "crashed-app",
          projectPath: "/repo/crashed",
          files: [
            { id: "f1", path: "src/index.ts", language: "typescript", size: 100 },
            { id: "f2", path: "src/new.ts", language: "typescript", size: 200 },
          ],
          dependencies: [],
          frameworks: [],
          languages: ["typescript"],
          discoveredAt: new Date().toISOString(),
        }),
      );

      await persistentStorage.save(
        createStorageRecord("symbol-table", {
          projectId,
          analysisRunId: run2Id,
          fileId: "f1",
          path: "src/index.ts",
          symbols: [
            {
              id: "s2",
              kind: "function",
              name: "crashedSymbol",
              filePath: "src/index.ts",
              language: "typescript",
              exported: true,
              defaultExport: false,
              async: false,
              anonymous: false,
              visibility: "public",
              parameters: [],
            },
          ],
        }),
      );

      provider.close();
    }

    // 3. Application reopens and verifies that DiscoveryQueryService isolates reads to Run 1
    {
      const provider = new SqliteStorageProvider({ databasePath: dbPath });
      const persistentStorage = new StorageManager(provider);
      const persistentQueryService = new DiscoveryQueryService(persistentStorage);

      // Logical query service verification: Run 1 remains the active completed run
      const latestCompletedRun = await persistentQueryService.getLatestCompletedRunId(projectId);
      expect(latestCompletedRun).toBe(run1Id);

      const activeDiscovery = await persistentQueryService.getProjectDiscovery(projectId);
      expect(activeDiscovery?.analysisRunId).toBe(run1Id);
      expect(activeDiscovery?.projectName).toBe("app");
      expect(activeDiscovery?.files).toHaveLength(1);

      const activeSymbols = await persistentQueryService.getSymbolsForFile(projectId, "src/index.ts");
      expect(activeSymbols).toHaveLength(1);
      expect(activeSymbols[0]?.name).toBe("v1Func");

      // 4. Consecutive new successful Run 3 executes and becomes the new latest completed run
      const run3Id = "33333333-3333-4333-8333-333333333333";
      await persistentStorage.saveBatch([
        createStorageRecord("project-discovery", {
          projectId,
          analysisRunId: run3Id,
          projectName: "app-v3",
          projectPath: "/repo/app",
          files: [
            { id: "f1", path: "src/index.ts", language: "typescript", size: 100 },
            { id: "f2", path: "src/v3.ts", language: "typescript", size: 300 },
          ],
          dependencies: [],
          frameworks: [],
          languages: ["typescript"],
          discoveredAt: new Date().toISOString(),
        }),
        createStorageRecord("symbol-table", {
          projectId,
          analysisRunId: run3Id,
          fileId: "f1",
          path: "src/index.ts",
          symbols: [
            {
              id: "s3",
              kind: "function",
              name: "v3Func",
              filePath: "src/index.ts",
              language: "typescript",
              exported: true,
              defaultExport: false,
              async: false,
              anonymous: false,
              visibility: "public",
              parameters: [],
            },
          ],
        }),
        createStorageRecord("analysis-run", {
          projectId,
          analysisRunId: run3Id,
          status: "completed",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        }),
      ]);

      const run3Active = await persistentQueryService.getLatestCompletedRunId(projectId);
      expect(run3Active).toBe(run3Id);

      const run3Discovery = await persistentQueryService.getProjectDiscovery(projectId);
      expect(run3Discovery?.analysisRunId).toBe(run3Id);
      expect(run3Discovery?.projectName).toBe("app-v3");

      const run3Symbols = await persistentQueryService.getSymbolsForFile(projectId, "src/index.ts");
      expect(run3Symbols).toHaveLength(1);
      expect(run3Symbols[0]?.name).toBe("v3Func");

      provider.close();
    }

    try {
      cleanupSqlite();
    } catch {
      // Ignore lock delay
    }
  });

  it("8. downstream analysis failure persists failed analysis-run record and emits AnalysisRunFailed event (F-09)", async () => {
    const testDir = join(import.meta.dir, "../../fixtures/scratch-f09-test");
    await mkdir(testDir, { recursive: true });
    await writeFile(
      join(testDir, "index.js"),
      "function add(a, b) { return a + b; }\nmodule.exports = { add };\n",
    );

    class DownstreamFailingSymbolExtractor extends JavaScriptSymbolExtractor {
      public failDownstream = false;

      public override extract(ast: any): any {
        const table = super.extract(ast);
        if (!this.failDownstream) {
          return table;
        }
        let accessCount = 0;
        return new Proxy(table, {
          get(target, prop, receiver) {
            if (prop === "symbols") {
              accessCount++;
              // Allow accesses during per-file record and event creation (3 accesses), then throw on downstream analysis access
              if (accessCount > 3) {
                throw new Error("Simulated unexpected downstream analysis crash");
              }
            }
            return Reflect.get(target, prop, receiver);
          },
        });
      }
    }

    try {
      const eventStore = new InMemoryEventStore();
      const eventBus = new EventBus();
      const receivedEvents: any[] = [];
      eventBus.subscribe("AnalysisRunFailed", (event) => receivedEvents.push(event));
      eventBus.subscribe("AnalysisRunCompleted", (event) => receivedEvents.push(event));

      const parserRegistry = new ParserRegistry();
      parserRegistry.register(new JavaScriptParser());
      const symbolExtractor = new DownstreamFailingSymbolExtractor();

      const orchestrator = new Orchestrator(
        eventStore,
        eventBus,
        storage,
        new DiscoveryEngine(),
        createProjectState("F-09 Test"),
        new ParserManager(parserRegistry),
        symbolExtractor,
      );

      // --- RUN 1: Successful run ---
      const run1Command = {
        id: run1Id,
        type: "AnalyzeProject" as const,
        createdAt: new Date(),
        payload: { projectId, path: testDir },
      };
      const exec1 = await orchestrator.execute(run1Command);
      expect(exec1.records.some((r) => r.type === "analysis-run")).toBe(true);
      expect(await queryService.getLatestCompletedRunId(projectId)).toBe(run1Id);
      expect(receivedEvents.some((e) => e.type === "AnalysisRunCompleted" && e.payload.analysisRunId === run1Id)).toBe(true);

      // --- RUN 2: Downstream failure injected ---
      symbolExtractor.failDownstream = true;
      const run2Command = {
        id: run2Id,
        type: "AnalyzeProject" as const,
        createdAt: new Date(),
        payload: { projectId, path: testDir },
      };

      const exec2 = await orchestrator.execute(run2Command);

      // 1. Orchestrator status returns to idle
      expect(orchestrator.getStatus()).toBe("idle");

      // 2. An analysis-run record exists with status: 'failed'
      const failedRunRecord = exec2.records.find((r) => r.type === "analysis-run");
      expect(failedRunRecord).toBeDefined();
      const failedPayload = failedRunRecord?.payload as any;
      expect(failedPayload.status).toBe("failed");
      expect(failedPayload.projectId).toBe(projectId);
      expect(failedPayload.analysisRunId).toBe(run2Id);
      expect(failedPayload.error).toBe("Simulated unexpected downstream analysis crash");

      // 3. Exactly one AnalysisRunFailed event emitted on EventBus and stored in EventStore
      const run2FailedEvents = eventStore.getAll().filter((e) => e.type === "AnalysisRunFailed");
      expect(run2FailedEvents).toHaveLength(1);
      expect(run2FailedEvents[0]?.payload).toMatchObject({
        projectId,
        analysisRunId: run2Id,
        error: "Simulated unexpected downstream analysis crash",
      });

      const busFailedEvents = receivedEvents.filter((e) => e.type === "AnalysisRunFailed" && e.payload.analysisRunId === run2Id);
      expect(busFailedEvents).toHaveLength(1);

      // 4. AnalysisRunCompleted is NOT emitted for Run 2
      const run2CompletedEvents = eventStore.getAll().filter((e) => e.type === "AnalysisRunCompleted" && (e.payload as any).analysisRunId === run2Id);
      expect(run2CompletedEvents).toHaveLength(0);

      // 5. QueryService preserves Run 1 as the latest completed run
      const activeRunAfterFailure = await queryService.getLatestCompletedRunId(projectId);
      expect(activeRunAfterFailure).toBe(run1Id);

      const activeDiscovery = await queryService.getProjectDiscovery(projectId);
      expect(activeDiscovery?.analysisRunId).toBe(run1Id);

      // 6. QueryService.listAnalysisRuns() contains both Run 1 (completed) and Run 2 (failed)
      const allRuns = await queryService.listAnalysisRuns(projectId);
      expect(allRuns).toHaveLength(2);
      expect(allRuns.find((r) => r.analysisRunId === run1Id)?.status).toBe("completed");
      expect(allRuns.find((r) => r.analysisRunId === run2Id)?.status).toBe("failed");
      expect(allRuns.find((r) => r.analysisRunId === run2Id)?.error).toBe("Simulated unexpected downstream analysis crash");

      // --- RUN 3: Subsequent normal run succeeds ---
      symbolExtractor.failDownstream = false;
      const run3IdLocal = "33333333-3333-4333-8333-333333333333";
      const run3Command = {
        id: run3IdLocal,
        type: "AnalyzeProject" as const,
        createdAt: new Date(),
        payload: { projectId, path: testDir },
      };

      const exec3 = await orchestrator.execute(run3Command);
      expect(orchestrator.getStatus()).toBe("idle");
      expect(exec3.records.some((r) => r.type === "analysis-run" && (r.payload as any).status === "completed")).toBe(true);

      const latestCompletedRun = await queryService.getLatestCompletedRunId(projectId);
      expect(latestCompletedRun).toBe(run3IdLocal);

      const allRunsAfterRun3 = await queryService.listAnalysisRuns(projectId);
      expect(allRunsAfterRun3).toHaveLength(3);
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });
});
