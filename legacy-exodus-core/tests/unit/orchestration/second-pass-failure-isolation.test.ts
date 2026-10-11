import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EventBus } from "@core/events/event-bus";
import { InMemoryEventStore } from "@core/events/event-store";
import { Orchestrator } from "@core/orchestration/orchestrator";
import {
  RunScopedAstStore,
  type AnalysisAstStore,
  type AnalysisAstStoreFactory,
} from "@core/orchestration/run-scoped-ast-store";
import { DiscoveryEngine } from "@discovery/index";
import { LegacyExodusEngine } from "@core/engine/engine";
import { JavaScriptParser, ParserManager, ParserRegistry, type ASTResult, type ParseRequest } from "@parser/index";
import { createEngineContext } from "@runtime/composition/services";
import { LegacyExodusError } from "@shared/errors";
import { JavaScriptSymbolExtractor } from "@symbols/index";
import { MemoryStorageProvider, StorageManager } from "@storage/index";

describe("IA-HIGH-001: Run-Scoped Parser Lifecycle", () => {
  let tempDir: string;
  let projectPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "le-second-pass-"));
    projectPath = join(tempDir, "workspace");
    const srcDir = join(projectPath, "src");
    await mkdir(srcDir, { recursive: true });

    await writeFile(
      join(srcDir, "file1.js"),
      "export function func1() { return 1; }\n",
      "utf8",
    );
    await writeFile(
      join(srcDir, "file2.js"),
      'import { func1 } from "./file1.js";\nexport function func2() { return func1(); }\n',
      "utf8",
    );
    await writeFile(join(projectPath, "README.md"), "# Fixture\n", "utf8");
    await writeFile(join(srcDir, "unsupported.py"), "print('fixture')\n", "utf8");
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { force: true, recursive: true });
    } catch {}
  });

  it("parses every supported source file exactly once during a fresh analysis", async () => {
    const registry = new ParserRegistry();
    registry.register(new JavaScriptParser());

    const parseCounts = new Map<string, number>();

    class CountingParserManager extends ParserManager {
      public override async parse(request: ParseRequest): Promise<ASTResult> {
        parseCounts.set(request.file.path, (parseCounts.get(request.file.path) ?? 0) + 1);
        return super.parse(request);
      }
    }

    const countingParserManager = new CountingParserManager(registry);
    const eventStore = new InMemoryEventStore();
    const eventBus = new EventBus();
    const storage = new StorageManager(new MemoryStorageProvider());

    const orchestrator = new Orchestrator(
      eventStore,
      eventBus,
      storage,
      new DiscoveryEngine(),
      undefined,
      countingParserManager,
      new JavaScriptSymbolExtractor(),
    );

    const tempEntriesBefore = (await readdir(tmpdir())).filter((entry) => entry.startsWith("legacy-exodus-ast-")).sort();
    const execution = await orchestrator.execute({
      id: randomUUID(),
      type: "AnalyzeProject",
      createdAt: new Date(),
      payload: {
        projectId: randomUUID(),
        path: projectPath,
      },
    });

    expect([...parseCounts.entries()].sort(([left], [right]) => left.localeCompare(right))).toEqual([
      ["src/file1.js", 1],
      ["src/file2.js", 1],
    ]);
    expect(execution.events.map((event) => event.type)).not.toContain("ParserFailure");
    expect(execution.events.map((event) => event.type)).toContain("AnalysisRunCompleted");
    expect(execution.records.filter((record) => record.type === "symbol-table")).toHaveLength(2);
    const semantic = execution.records.find((record) => record.type === "semantic-analysis");
    const controlFlow = execution.records.find((record) => record.type === "control-flow-analysis");
    const dataFlow = execution.records.find((record) => record.type === "data-flow-analysis");
    expect((semantic?.payload as { readonly calls: readonly { readonly resolutionState: string }[] }).calls.map((call) => call.resolutionState)).toEqual(["RESOLVED"]);
    expect((controlFlow?.payload as { readonly graphs: readonly unknown[] }).graphs).toHaveLength(4);
    expect((dataFlow?.payload as { readonly graphs: readonly unknown[] }).graphs).toHaveLength(2);
    expect(execution.analysis?.unsupportedFiles).toBe(1);
    expect(execution.analysis?.nonSourceArtifacts).toBe(1);
    expect(orchestrator.getAstStoreCleanupFailures()).toEqual([]);
    expect((await readdir(tmpdir())).filter((entry) => entry.startsWith("legacy-exodus-ast-")).sort()).toEqual(tempEntriesBefore);
  });

  it("preserves successful analysis and reports a secondary cleanup failure", async () => {
    const cleanupError = new Error("injected cleanup failure");
    const reported: unknown[] = [];
    const orchestrator = createOrchestrator({
      astStoreFactory: createFaultInjectingAstStoreFactory({ cleanupError }),
      cleanupReporter: (failure) => reported.push(failure),
    });

    const execution = await analyze(orchestrator, projectPath);

    expect(execution.events.map((event) => event.type)).toContain("AnalysisRunCompleted");
    expect(execution.events.map((event) => event.type)).not.toContain("AnalysisRunFailed");
    expect(orchestrator.getAstStoreCleanupFailures()).toEqual([
      expect.objectContaining({ stage: "cleanup", error: cleanupError }),
    ]);
    expect(reported).toEqual([
      expect.objectContaining({ stage: "cleanup", error: cleanupError }),
    ]);
  });

  it("preserves an analysis failure when cleanup succeeds", async () => {
    const primaryError = new LegacyExodusError({
      code: "PRIMARY_ANALYSIS_FAILURE",
      message: "injected primary analysis failure",
    });
    const orchestrator = createOrchestrator({
      astStoreFactory: createFaultInjectingAstStoreFactory({ writeError: primaryError }),
    });

    const execution = await analyze(orchestrator, projectPath);
    const failed = execution.events.find((event) => event.type === "AnalysisRunFailed");

    expect(failed?.payload).toEqual(expect.objectContaining({ error: primaryError.message }));
    expect(execution.events.map((event) => event.type)).not.toContain("AnalysisRunCompleted");
    expect(orchestrator.getAstStoreCleanupFailures()).toEqual([]);
  });

  it("preserves the primary analysis failure and reports a secondary cleanup failure", async () => {
    const primaryError = new LegacyExodusError({
      code: "PRIMARY_ANALYSIS_FAILURE",
      message: "injected primary analysis failure",
    });
    const cleanupError = new Error("injected cleanup failure");
    const orchestrator = createOrchestrator({
      astStoreFactory: createFaultInjectingAstStoreFactory({ writeError: primaryError, cleanupError }),
    });

    const execution = await analyze(orchestrator, projectPath);
    const failed = execution.events.find((event) => event.type === "AnalysisRunFailed");

    expect(failed?.payload).toEqual(expect.objectContaining({ error: primaryError.message }));
    expect(execution.events.map((event) => event.type)).not.toContain("AnalysisRunCompleted");
    expect(orchestrator.getAstStoreCleanupFailures()).toEqual([
      expect.objectContaining({ stage: "cleanup", error: cleanupError }),
    ]);
  });

  it("isolates a second-pass AST restoration failure and continues healthy files", async () => {
    const parseCounts = new Map<string, number>();
    const readCounts = new Map<string, number>();
    const registry = new ParserRegistry();
    registry.register(new JavaScriptParser());

    class CountingParserManager extends ParserManager {
      public override async parse(request: ParseRequest): Promise<ASTResult> {
        parseCounts.set(request.file.path, (parseCounts.get(request.file.path) ?? 0) + 1);
        return super.parse(request);
      }
    }

    const orchestrator = new Orchestrator(
      new InMemoryEventStore(),
      new EventBus(),
      new StorageManager(new MemoryStorageProvider()),
      new DiscoveryEngine(),
      undefined,
      new CountingParserManager(registry),
      new JavaScriptSymbolExtractor(),
      undefined,
      createFaultInjectingAstStoreFactory({ readFailurePath: "src/file2.js", readCounts }),
    );

    const execution = await analyze(orchestrator, projectPath);
    const parserFailures = execution.events.filter((event) => event.type === "ParserFailure");
    const controlFlow = execution.records.find((record) => record.type === "control-flow-analysis");
    const graphs = (controlFlow?.payload as { readonly graphs: readonly { readonly filePath: string }[] }).graphs;

    expect([...parseCounts.entries()].sort(([left], [right]) => left.localeCompare(right))).toEqual([
      ["src/file1.js", 1],
      ["src/file2.js", 1],
    ]);
    expect([...readCounts.entries()].sort(([left], [right]) => left.localeCompare(right))).toEqual([
      ["src/file1.js", 1],
      ["src/file2.js", 1],
    ]);
    expect(parserFailures.map((event) => event.payload)).toEqual([
      expect.objectContaining({ path: "src/file2.js", code: "AST_RESTORE_INJECTED" }),
    ]);
    expect(execution.events.map((event) => event.type)).toContain("AnalysisRunCompleted");
    expect(execution.events.map((event) => event.type)).not.toContain("AnalysisRunFailed");
    expect(graphs.some((graph) => graph.filePath === "src/file1.js")).toBe(true);
    expect(graphs.some((graph) => graph.filePath === "src/file2.js")).toBe(false);
    // R4: retained tables are primary successes; restoration degradation is orthogonal.
    expect(execution.records.filter((record) => record.type === "symbol-table")).toHaveLength(2);
    expect(execution.analysis).toMatchObject({
      filesDiscovered: 4, filesAnalyzed: 2, parserFailures: 0,
      symbolExtractionFailures: 0, unsupportedFiles: 1, nonSourceArtifacts: 1,
      unclassifiedArtifacts: 0, enumerationFailures: 0, secondPassFailures: 1,
      discoveryComplete: true,
    });
  });

  it("preserves first-pass parser failure isolation without retrying the failed file", async () => {
    const registry = new ParserRegistry();
    registry.register(new JavaScriptParser());
    const parseCounts = new Map<string, number>();

    class FaultInjectingParserManager extends ParserManager {
      public override async parse(request: ParseRequest): Promise<ASTResult> {
        parseCounts.set(request.file.path, (parseCounts.get(request.file.path) ?? 0) + 1);
        if (request.file.path === "src/file2.js") throw new Error("Simulated parser failure");
        return super.parse(request);
      }
    }

    const orchestrator = new Orchestrator(
      new InMemoryEventStore(),
      new EventBus(),
      new StorageManager(new MemoryStorageProvider()),
      new DiscoveryEngine(),
      undefined,
      new FaultInjectingParserManager(registry),
      new JavaScriptSymbolExtractor(),
    );

    const execution = await orchestrator.execute({
      id: randomUUID(),
      type: "AnalyzeProject",
      createdAt: new Date(),
      payload: { projectId: randomUUID(), path: projectPath },
    });

    expect([...parseCounts.entries()].sort(([left], [right]) => left.localeCompare(right))).toEqual([
      ["src/file1.js", 1],
      ["src/file2.js", 1],
    ]);
    expect(execution.analysis?.filesAnalyzed).toBe(1);
    expect(execution.analysis?.parserFailures).toBe(1);
    expect(execution.events.filter((event) => event.type === "ParserFailure").map((event) => (event.payload as { readonly path: string }).path)).toEqual(["src/file2.js"]);
    expect(execution.events.map((event) => event.type)).not.toContain("AnalysisRunFailed");
    expect(execution.records.filter((record) => record.type === "symbol-table")).toHaveLength(1);
  });

  it("performs zero parser calls when a validated snapshot is reused", async () => {
    const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    const originalParse = context.parserManager.parse.bind(context.parserManager);
    let parserCalls = 0;
    context.parserManager.parse = async (request: ParseRequest): Promise<ASTResult> => {
      parserCalls += 1;
      return originalParse(request);
    };
    const engine = new LegacyExodusEngine(context);
    await engine.initialize();

    try {
      const first = await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: projectPath },
      });
      expect(first.type).toBe("AnalyzeProject");
      expect(parserCalls).toBe(2);

      const second = await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: projectPath },
      });
      expect(second.type).toBe("AnalyzeProject");
      if (second.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject result");
      expect(second.isReused).toBe(true);
      expect(parserCalls).toBe(2);
    } finally {
      await engine.shutdown();
    }
  });

  it("produces deterministic logical analysis artifacts across fresh runs", async () => {
    const registry = new ParserRegistry();
    registry.register(new JavaScriptParser());
    const orchestrator = new Orchestrator(
      new InMemoryEventStore(),
      new EventBus(),
      new StorageManager(new MemoryStorageProvider()),
      new DiscoveryEngine(),
      undefined,
      new ParserManager(registry),
      new JavaScriptSymbolExtractor(),
    );

    const execute = () => orchestrator.execute({
      id: randomUUID(),
      type: "AnalyzeProject" as const,
      createdAt: new Date(),
      payload: { projectId: "00000000-0000-4000-8000-b00000000001", path: projectPath },
    });
    const first = await execute();
    const second = await execute();

    expect(logicalArtifacts(first.records)).toEqual(logicalArtifacts(second.records));
  });

  it("rehydrates an equivalent deeply immutable AST and rejects access after cleanup", async () => {
    const registry = new ParserRegistry();
    registry.register(new JavaScriptParser());
    const manager = new ParserManager(registry);
    const ast = await manager.parse({
      file: { id: "file:test", path: "src/test.ts", size: 42, language: "typescript", fileKind: "source" },
      source: "export function example(value: string) { return value.trim(); }",
    });
    const store = await RunScopedAstStore.create();

    await store.write(ast);
    const restored = await store.read(ast.metadata.sourcePath);
    expect(restored).toEqual(ast);
    expect(restored).not.toBe(ast);
    expect(Object.isFrozen(restored)).toBe(true);
    expect(Object.isFrozen(restored.metadata)).toBe(true);
    expect(Object.isFrozen(restored.statistics)).toBe(true);
    expect(isDeeplyFrozenNode(restored.root)).toBe(true);

    await store.dispose();
    await expect(store.read(ast.metadata.sourcePath)).rejects.toMatchObject({ code: "AST_SPILL_DISPOSED" });
  });
});

function logicalArtifacts(records: readonly { readonly type: string; readonly payload: unknown }[]): readonly unknown[] {
  const retainedTypes = new Set([
    "symbol-table",
    "dependency-graph",
    "semantic-analysis",
    "control-flow-analysis",
    "data-flow-analysis",
    "knowledge-graph",
  ]);
  return records
    .filter((record) => retainedTypes.has(record.type))
    .map((record) => {
      const payload = record.payload as Readonly<Record<string, unknown>>;
      const { projectId: _projectId, analysisRunId: _analysisRunId, ...logicalPayload } = payload;
      return { type: record.type, payload: logicalPayload };
    });
}

function isDeeplyFrozenNode(node: ASTResult["root"]): boolean {
  return Object.isFrozen(node)
    && Object.isFrozen(node.attributes)
    && Object.isFrozen(node.children)
    && (node.location === undefined
      || (Object.isFrozen(node.location) && Object.isFrozen(node.location.start) && Object.isFrozen(node.location.end)))
    && node.children.every(isDeeplyFrozenNode);
}

interface FaultInjectingAstStoreOptions {
  readonly writeError?: Error;
  readonly readFailurePath?: string;
  readonly readCounts?: Map<string, number>;
  readonly cleanupError?: Error;
}

function createFaultInjectingAstStoreFactory(
  options: FaultInjectingAstStoreOptions,
): AnalysisAstStoreFactory {
  return async (): Promise<AnalysisAstStore> => {
    const store = await RunScopedAstStore.create();
    return {
      async write(ast: ASTResult): Promise<void> {
        if (options.writeError !== undefined) throw options.writeError;
        await store.write(ast);
      },
      async read(sourcePath: string): Promise<ASTResult> {
        options.readCounts?.set(sourcePath, (options.readCounts.get(sourcePath) ?? 0) + 1);
        if (sourcePath === options.readFailurePath) {
          throw new LegacyExodusError({
            code: "AST_RESTORE_INJECTED",
            message: "injected AST restoration failure",
          });
        }
        return store.read(sourcePath);
      },
      async dispose(): Promise<void> {
        await store.dispose();
        if (options.cleanupError !== undefined) throw options.cleanupError;
      },
    };
  };
}

interface OrchestratorOptions {
  readonly astStoreFactory: AnalysisAstStoreFactory;
  readonly cleanupReporter?: (failure: unknown) => void;
}

function createOrchestrator(options: OrchestratorOptions): Orchestrator {
  return new Orchestrator(
    new InMemoryEventStore(),
    new EventBus(),
    new StorageManager(new MemoryStorageProvider()),
    new DiscoveryEngine(),
    undefined,
    undefined,
    undefined,
    undefined,
    options.astStoreFactory,
    options.cleanupReporter,
  );
}

function analyze(orchestrator: Orchestrator, projectPath: string) {
  return orchestrator.execute({
    id: randomUUID(),
    type: "AnalyzeProject",
    createdAt: new Date(),
    payload: { projectId: randomUUID(), path: projectPath },
  });
}
