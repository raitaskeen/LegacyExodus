import { beforeEach, describe, expect, it } from "bun:test";
import { DiscoveryQueryService } from "@discovery/discovery-query-service";
import { MemoryStorageProvider } from "@storage/adapters/memory-storage";
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

describe("Analysis-Run Atomicity & Completion Semantics (F-004)", () => {
  let storage: StorageManager;
  let queryService: DiscoveryQueryService;

  const projectId = "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d";
  const run1Id = "11111111-1111-4111-8111-111111111111";
  const run2Id = "22222222-2222-4222-8222-222222222222";

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
            exported: true,
            defaultExport: false,
            moduleSpecifier: null,
            sourceSymbolName: null,
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
            exported: true,
            defaultExport: false,
            moduleSpecifier: null,
            sourceSymbolName: null,
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

  it("5. orchestrator executes full analysis and emits completed analysis-run record and events", async () => {
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
});
