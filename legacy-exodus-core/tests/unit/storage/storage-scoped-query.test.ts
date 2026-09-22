import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { Statement } from "bun:sqlite";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createStorageRecord,
  extractRecordMetadata,
  MemoryStorageProvider,
  SqliteStorageProvider,
  StorageManager,
  type SerializedPayload,
  type StorageProvider,
  type StorageRecord,
} from "@storage/index";
import { DiscoveryQueryService } from "@discovery/discovery-query-service";

describe("Storage Scoped Query Contract & Bounded Retrieval", () => {
  const projA = "aaaaaaaa-0000-4000-8000-000000000001";
  const projB = "bbbbbbbb-0000-4000-8000-000000000002";
  const run1 = "11111111-0000-4000-8000-000000000001";
  const run2 = "22222222-0000-4000-8000-000000000002";

  async function collectScoped<Payload extends SerializedPayload>(
    records: AsyncIterable<StorageRecord<Payload>>,
  ): Promise<StorageRecord<Payload>[]> {
    const collected: StorageRecord<Payload>[] = [];
    for await (const record of records) {
      collected.push(record);
    }
    return collected;
  }

  function runMatrixTests(createProvider: () => { provider: StorageProvider; cleanup?: () => Promise<void> | void }) {
    let provider: StorageProvider;
    let cleanupFn: (() => Promise<void> | void) | undefined;

    beforeEach(async () => {
      const created = createProvider();
      provider = created.provider;
      cleanupFn = created.cleanup;
    });

    afterEach(async () => {
      await cleanupFn?.();
      await provider.close?.();
    });

    it("Test A/B: retrieves only the targeted record matching type, project, run, and file", async () => {
      const recA1a = createStorageRecord("symbol-table", { projectId: projA, analysisRunId: run1, path: "src/a.ts", name: "A1a" });
      const recA1b = createStorageRecord("symbol-table", { projectId: projA, analysisRunId: run1, path: "src/b.ts", name: "A1b" });
      const recA2a = createStorageRecord("symbol-table", { projectId: projA, analysisRunId: run2, path: "src/a.ts", name: "A2a" });
      const recB1a = createStorageRecord("symbol-table", { projectId: projB, analysisRunId: run1, path: "src/a.ts", name: "B1a" });

      await provider.save(recA1a);
      await provider.save(recA1b);
      await provider.save(recA2a);
      await provider.save(recB1a);

      const scoped = await provider.findScoped({
        type: "symbol-table",
        projectId: projA,
        analysisRunId: run1,
        filePath: "src/a.ts",
      });

      expect(scoped).toHaveLength(1);
      expect(scoped[0]!.id).toBe(recA1a.id);
      expect((scoped[0]!.payload as any).name).toBe("A1a");
    });

    it("Test C: enforces strict run isolation (run 1 != run 2 for identical project and file)", async () => {
      const recRun1 = createStorageRecord("flow-data", { projectId: projA, analysisRunId: run1, path: "index.ts", data: "run1" });
      const recRun2 = createStorageRecord("flow-data", { projectId: projA, analysisRunId: run2, path: "index.ts", data: "run2" });

      await provider.save(recRun1);
      await provider.save(recRun2);

      const resRun1 = await provider.findScoped({ type: "flow-data", projectId: projA, analysisRunId: run1 });
      expect(resRun1).toHaveLength(1);
      expect((resRun1[0]!.payload as any).data).toBe("run1");

      const resRun2 = await provider.findScoped({ type: "flow-data", projectId: projA, analysisRunId: run2 });
      expect(resRun2).toHaveLength(1);
      expect((resRun2[0]!.payload as any).data).toBe("run2");
    });

    it("Test D: enforces strict project isolation (project A != project B)", async () => {
      const recProjA = createStorageRecord("cfg-data", { projectId: projA, analysisRunId: run1, graph: "A" });
      const recProjB = createStorageRecord("cfg-data", { projectId: projB, analysisRunId: run1, graph: "B" });

      await provider.save(recProjA);
      await provider.save(recProjB);

      const resA = await provider.findScoped({ type: "cfg-data", projectId: projA });
      expect(resA).toHaveLength(1);
      expect((resA[0]!.payload as any).graph).toBe("A");

      const resB = await provider.findScoped({ type: "cfg-data", projectId: projB });
      expect(resB).toHaveLength(1);
      expect((resB[0]!.payload as any).graph).toBe("B");
    });

    it("Test E: enforces file isolation (file A != file B)", async () => {
      const fileA = createStorageRecord("file-ast", { projectId: projA, analysisRunId: run1, filePath: "src/fileA.ts", ast: "A" });
      const fileB = createStorageRecord("file-ast", { projectId: projA, analysisRunId: run1, filePath: "src/fileB.ts", ast: "B" });

      await provider.save(fileA);
      await provider.save(fileB);

      const resFileA = await provider.findScoped({ type: "file-ast", projectId: projA, filePath: "src/fileA.ts" });
      expect(resFileA).toHaveLength(1);
      expect((resFileA[0]!.payload as any).ast).toBe("A");

      const resFileB = await provider.findScoped({ type: "file-ast", projectId: projA, filePath: "src/fileB.ts" });
      expect(resFileB).toHaveLength(1);
      expect((resFileB[0]!.payload as any).ast).toBe("B");
    });

    it("Test F: guarantees deterministic ordering and tie-breaking by id", async () => {
      const rec1 = createStorageRecord("ordered-type", { projectId: projA, seq: 1 });
      const rec2 = createStorageRecord("ordered-type", { projectId: projA, seq: 2 });
      const rec3 = createStorageRecord("ordered-type", { projectId: projA, seq: 3 });

      // Save in specific order
      await provider.save(rec1);
      await provider.save(rec2);
      await provider.save(rec3);

      const retrieved = await provider.findScoped({ type: "ordered-type", projectId: projA });
      expect(retrieved.map((r) => r.id)).toEqual([rec1.id, rec2.id, rec3.id]);
    });

    it("streams matching records incrementally with findScoped-equivalent filters and natural order", async () => {
      const first = createStorageRecord("streamed-type", {
        projectId: projA,
        analysisRunId: run1,
        path: "src/target.ts",
        sequence: 1,
      });
      const second = createStorageRecord("streamed-type", {
        projectId: projA,
        analysisRunId: run1,
        path: "src/target.ts",
        sequence: 2,
      });
      const wrongType = createStorageRecord("other-type", {
        projectId: projA,
        analysisRunId: run1,
        path: "src/target.ts",
      });
      const wrongProject = createStorageRecord("streamed-type", {
        projectId: projB,
        analysisRunId: run1,
        path: "src/target.ts",
      });
      const wrongRun = createStorageRecord("streamed-type", {
        projectId: projA,
        analysisRunId: run2,
        path: "src/target.ts",
      });
      const wrongFile = createStorageRecord("streamed-type", {
        projectId: projA,
        analysisRunId: run1,
        path: "src/other.ts",
      });

      for (const record of [first, wrongType, wrongProject, second, wrongRun, wrongFile]) {
        await provider.save(record);
      }

      const stream = provider.iterateScoped({
        type: "streamed-type",
        projectId: projA,
        analysisRunId: run1,
        filePath: "src/target.ts",
      });

      expect(Array.isArray(stream)).toBe(false);
      expect(typeof stream[Symbol.asyncIterator]).toBe("function");
      const streamed = await collectScoped(stream);
      expect(streamed.map((record) => record.id)).toEqual([first.id, second.id]);
      expect(streamed.map((record) => record.payload)).toEqual([first.payload, second.payload]);
    });
  }

  describe("MemoryStorageProvider Scoped Retrieval", () => {
    runMatrixTests(() => ({ provider: new MemoryStorageProvider() }));
  });

  describe("SqliteStorageProvider Scoped Retrieval", () => {
    runMatrixTests(() => ({ provider: new SqliteStorageProvider({ inMemory: true }) }));
  });

  describe("Persistent File SQLite Scoped Retrieval", () => {
    let testDbPath: string;
    runMatrixTests(() => {
      testDbPath = join(tmpdir(), `test-scoped-sqlite-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
      return {
        provider: new SqliteStorageProvider({ databasePath: testDbPath }),
        cleanup: async () => {
          try {
            await rm(testDbPath, { force: true });
            await rm(`${testDbPath}-wal`, { force: true });
            await rm(`${testDbPath}-shm`, { force: true });
          } catch {}
        },
      };
    });
  });

  describe("SQLite scoped iterator lifecycle", () => {
    it("finalizes its prepared statement when a consumer breaks early", async () => {
      const provider = new SqliteStorageProvider({ inMemory: true });
      const first = createStorageRecord("stream-lifecycle", { projectId: projA, sequence: 1 });
      const second = createStorageRecord("stream-lifecycle", { projectId: projA, sequence: 2 });
      await provider.save(first);
      await provider.save(second);

      const finalizeSpy = spyOn(Statement.prototype, "finalize");
      const callsBeforeIteration = finalizeSpy.mock.calls.length;

      try {
        const consumed: string[] = [];
        for await (const record of provider.iterateScoped({
          type: "stream-lifecycle",
          projectId: projA,
        })) {
          consumed.push(record.id);
          break;
        }

        expect(consumed).toEqual([first.id]);
        expect(finalizeSpy.mock.calls.length).toBe(callsBeforeIteration + 1);
      } finally {
        finalizeSpy.mockRestore();
        provider.close();
      }
    });

    it("finalizes its prepared statement when consumer code throws", async () => {
      const provider = new SqliteStorageProvider({ inMemory: true });
      const record = createStorageRecord("stream-lifecycle", { projectId: projA, sequence: 1 });
      await provider.save(record);

      const finalizeSpy = spyOn(Statement.prototype, "finalize");
      const callsBeforeIteration = finalizeSpy.mock.calls.length;
      const consumerFailure = new Error("consumer stopped");

      try {
        try {
          for await (const _record of provider.iterateScoped({
            type: "stream-lifecycle",
            projectId: projA,
          })) {
            throw consumerFailure;
          }
        } catch (error: unknown) {
          expect(error).toBe(consumerFailure);
        }

        expect(finalizeSpy.mock.calls.length).toBe(callsBeforeIteration + 1);
      } finally {
        finalizeSpy.mockRestore();
        provider.close();
      }
    });
  });

  describe("Test G: DiscoveryQueryService regression & provider parity", () => {
    for (const providerType of ["memory", "sqlite"] as const) {
      it(`executes all query methods identically using ${providerType} provider`, async () => {
        const provider: StorageProvider = providerType === "memory"
          ? new MemoryStorageProvider()
          : new SqliteStorageProvider({ inMemory: true });
        const manager = new StorageManager(provider);
        const service = new DiscoveryQueryService(manager);

        const discRecord = createStorageRecord("project-discovery", {
          projectId: projA,
          analysisRunId: run1,
          projectName: "test-app",
          projectPath: "/repo/test-app",
          files: [{ id: "f1", path: "src/app.ts", language: "typescript", size: 50 }],
          dependencies: [{ name: "fastify", version: "5.0.0", kind: "production" as const }],
          frameworks: [{ name: "fastify", evidence: "package.json" }],
          languages: ["typescript"],
          discoveredAt: new Date().toISOString(),
        });

        const symRecord = createStorageRecord("symbol-table", {
          projectId: projA,
          analysisRunId: run1,
          path: "src/app.ts",
          symbols: [
            { id: "s1", kind: "function", name: "listen", filePath: "src/app.ts", language: "typescript", exported: true, defaultExport: false, async: false, anonymous: false, visibility: "public", parameters: [] },
          ],
        });

        const depRecord = createStorageRecord("dependency-graph", {
          projectId: projA,
          analysisRunId: run1,
          nodes: [{ id: "n1", filePath: "src/app.ts", symbolId: "s1" }],
          edges: [],
          cycles: [],
        });

        const kgRecord = createStorageRecord("knowledge-graph", {
          projectId: projA,
          analysisRunId: run1,
          nodes: [{ id: "k1", kind: "module", name: "app", filePath: "src/app.ts" }],
          edges: [],
        });

        const semRecord = createStorageRecord("semantic-analysis", {
          projectId: projA,
          analysisRunId: run1,
          calls: [{
            id: "call-1",
            sourceFilePath: "src/app.ts",
            callerName: "listen",
            calleeName: "fastify",
            resolutionState: "UNRESOLVED",
          }],
          references: [],
          scopes: [],
          deadCode: [],
          unusedImports: [],
          unusedExports: [],
          entryPoints: [],
          routes: [],
          middlewareChains: [],
        });

        const cfgRecord = createStorageRecord("control-flow-analysis", {
          projectId: projA,
          analysisRunId: run1,
          graphs: [{
            id: "cfg1",
            filePath: "src/app.ts",
            scopeName: "module",
            state: "RESOLVED",
            entryBlockId: "entry",
            exitBlockId: "exit",
            blocks: [
              { id: "entry", statements: [], predecessorIds: [], successorIds: ["exit"] },
              { id: "exit", statements: [], predecessorIds: ["entry"], successorIds: [] },
            ],
            edges: [{ id: "edge1", fromBlockId: "entry", toBlockId: "exit", kind: "next" }],
            dominators: [
              { blockId: "entry" },
              { blockId: "exit", immediateDominatorId: "entry" },
            ],
            loops: [],
            unreachableBlockIds: [],
            deadCodeNodeIds: [],
          }],
        });

        const dfgRecord = createStorageRecord("data-flow-analysis", {
          projectId: projA,
          analysisRunId: run1,
          graphs: [{
            id: "dfg1",
            filePath: "src/app.ts",
            state: "RESOLVED",
            definitions: [],
            uses: [],
            defUseChains: [],
            lifetimes: [],
            taintFlows: [],
            interproceduralFlows: [],
            functionSummaries: [],
            callBindings: [],
          }],
        });

        await manager.save(discRecord);
        await manager.save(symRecord);
        await manager.save(depRecord);
        await manager.save(kgRecord);
        await manager.save(semRecord);
        await manager.save(cfgRecord);
        await manager.save(dfgRecord);

        // Verify Discovery
        const disc = await service.getProjectDiscovery(projA, run1);
        expect(disc).not.toBeNull();
        expect(disc?.projectName).toBe("test-app");

        // Verify Files
        const files = await service.getDiscoveredFiles(projA, run1);
        expect(files).toHaveLength(1);
        expect(files[0]!.path).toBe("src/app.ts");

        // Verify Symbols
        const symbols = await service.getSymbolsForFile(projA, "src/app.ts", run1);
        expect(symbols).toHaveLength(1);
        expect(symbols[0]!.name).toBe("listen");

        // Verify non-matching file returns empty
        const noSymbols = await service.getSymbolsForFile(projA, "src/other.ts", run1);
        expect(noSymbols).toHaveLength(0);

        // Verify Dep Graph
        const depGraph = await service.getDependencyGraph(projA, run1);
        expect(depGraph?.nodes).toHaveLength(1);

        // Verify Knowledge Graph
        const kg = await service.getKnowledgeGraph(projA, run1);
        expect(kg?.nodes).toHaveLength(1);

        // Verify Semantic Analysis
        const sem = await service.getSemanticAnalysis(projA, run1);
        expect((sem as any)?.calls).toHaveLength(1);

        // Verify Control Flow Analysis
        const cfg = await service.getControlFlowAnalysis(projA, run1);
        expect((cfg as any)?.graphs).toHaveLength(1);

        // Verify Data Flow Analysis
        const dfg = await service.getDataFlowAnalysis(projA, run1);
        expect((dfg as any)?.graphs).toHaveLength(1);

        await manager.close();
      });
    }
  });

  describe("Test H: Large-Record-Set Boundedness Proof", () => {
    it("proves a single-file query on SQLite fetches exactly the bounded record among 100 synthetic file records", async () => {
      const sqliteProvider = new SqliteStorageProvider({ inMemory: true });
      const manager = new StorageManager(sqliteProvider);
      const service = new DiscoveryQueryService(manager);

      // Populate 100 different file symbol tables
      for (let i = 1; i <= 100; i++) {
        const rec = createStorageRecord("symbol-table", {
          projectId: projA,
          analysisRunId: run1,
          path: `src/module_${i}.ts`,
          symbols: [
            {
              id: `sym_${i}`,
              kind: "function",
              name: `handler_${i}`,
              filePath: `src/module_${i}.ts`,
              language: "typescript",
              exported: true,
              defaultExport: false,
              async: false,
              anonymous: false,
              visibility: "public",
              parameters: [],
            },
          ],
        });
        await manager.save(rec);
      }

      // Query only module_42.ts
      const symbols = await service.getSymbolsForFile(projA, "src/module_42.ts", run1);
      expect(symbols).toHaveLength(1);
      expect(symbols[0]!.name).toBe("handler_42");

      // Verify that findScoped directly returns exactly 1 record from SQLite
      const scopedRecords = await sqliteProvider.findScoped({
        type: "symbol-table",
        projectId: projA,
        analysisRunId: run1,
        filePath: "src/module_42.ts",
      });
      expect(scopedRecords).toHaveLength(1);
      expect(scopedRecords[0]!.type).toBe("symbol-table");
      expect((scopedRecords[0]!.payload as any).path).toBe("src/module_42.ts");

      sqliteProvider.close();
    });
  });

  describe("Test I: Metadata extraction helper integrity", () => {
    it("extracts projectId, analysisRunId, and path/filePath correctly from various payload shapes", () => {
      expect(extractRecordMetadata(null)).toEqual({ projectId: null, analysisRunId: null, filePath: null });
      expect(extractRecordMetadata("string")).toEqual({ projectId: null, analysisRunId: null, filePath: null });
      expect(extractRecordMetadata({ projectId: "p1", analysisRunId: "r1", path: "src/index.ts" })).toEqual({
        projectId: "p1",
        analysisRunId: "r1",
        filePath: "src/index.ts",
      });
      expect(extractRecordMetadata({ projectId: "p2", filePath: "src/lib.ts" })).toEqual({
        projectId: "p2",
        analysisRunId: null,
        filePath: "src/lib.ts",
      });
    });
  });
});
