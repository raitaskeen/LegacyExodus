import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, test } from "bun:test";

import type { InitializeProjectCommand } from "@contracts/commands";
import { EventBus } from "@core/events/event-bus";
import { InMemoryEventStore } from "@core/events/event-store";
import { Orchestrator } from "@core/orchestration/orchestrator";
import { ProjectStatus } from "@core/state/project-state";
import { DiscoveryEngine } from "@discovery/index";
import { ParserManager, ParserRegistry, type Parser } from "@parser/index";
import { LegacyExodusError } from "@shared/errors";
import { MemoryStorageProvider, StorageManager } from "@storage/index";
import { JavaScriptSymbolExtractor } from "@symbols/index";

describe("Orchestrator", () => {
  test("handles an initialization command and stores its event", async (): Promise<void> => {
    const eventStore = new InMemoryEventStore();
    const orchestrator = new Orchestrator(
      eventStore,
      new EventBus(),
      new StorageManager(new MemoryStorageProvider()),
    );
    const command: InitializeProjectCommand = {
      id: "00000000-0000-4000-8000-000000000010",
      type: "InitializeProject",
      createdAt: new Date(),
      payload: {
        projectId: "00000000-0000-4000-8000-000000000011",
        name: "Legacy inventory system",
      },
    };

    const execution = await orchestrator.execute(command);
    const [event] = execution.events;

    expect(event?.type).toBe("ProjectInitialized");
    expect(eventStore.getAll()).toEqual(execution.events);
    expect(orchestrator.replay().name).toBe("Legacy inventory system");
    expect(orchestrator.getStatus()).toBe("idle");
  });

  test("emits a stable parser failure code and continues analysis", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-parser-failure-"));
    const eventStore = new InMemoryEventStore();
    const registry = new ParserRegistry();
    registry.register(createFailingParser());
    const orchestrator = new Orchestrator(
      eventStore,
      new EventBus(),
      new StorageManager(new MemoryStorageProvider()),
      new DiscoveryEngine(),
      undefined,
      new ParserManager(registry),
    );

    try {
      await writeFile(join(projectPath, "broken.js"), "export const value = 1;", "utf8");
      await orchestrator.execute({
        id: "00000000-0000-4000-8000-000000000060",
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: "00000000-0000-4000-8000-000000000061", path: projectPath },
      });

      expect(eventStore.getByType("ParserFailure")[0]?.payload).toEqual({
        fileId: expect.any(String),
        path: "broken.js",
        code: "PARSER_EXECUTION_FAILED",
      });
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });

  test("isolates symbol extraction failure to the affected file", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-symbol-failure-"));
    const eventStore = new InMemoryEventStore();
    const orchestrator = new Orchestrator(
      eventStore, new EventBus(), new StorageManager(new MemoryStorageProvider()),
      new DiscoveryEngine(), undefined, undefined, new FailingSymbolExtractor(),
    );
    try {
      await writeFile(join(projectPath, "bad.js"), "export const bad = 1;", "utf8");
      await writeFile(join(projectPath, "good.js"), "export const good = 1;", "utf8");
      const execution = await orchestrator.execute({ id: "00000000-0000-4000-8000-000000000062", type: "AnalyzeProject", createdAt: new Date(), payload: { projectId: "00000000-0000-4000-8000-000000000063", path: projectPath } });

      expect(eventStore.getByType("SymbolsExtractionFailure")[0]).toMatchObject({ payload: { fileId: expect.any(String), path: "bad.js", code: "SYMBOL_EXTRACTION_FAILED" } });
      expect(eventStore.getByType("SymbolsExtracted")[0]).toMatchObject({ payload: { path: "good.js" } });
      expect(execution.analysis).toMatchObject({
        filesDiscovered: 2,
        filesAnalyzed: 1,
        parserFailures: 0,
        symbolExtractionFailures: 1,
        unsupportedFiles: 0,
        nonSourceArtifacts: 0,
        unclassifiedArtifacts: 0,
      });
      expect(execution.analysis?.durationMs).toBeGreaterThanOrEqual(0);
    } finally { await rm(projectPath, { force: true, recursive: true }); }
  });

  test("replays complete lifecycle transition to COMPLETED after successful AnalyzeProject (EVT-01)", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-replay-"));
    const eventStore = new InMemoryEventStore();
    const orchestrator = new Orchestrator(
      eventStore,
      new EventBus(),
      new StorageManager(new MemoryStorageProvider()),
    );

    try {
      await writeFile(join(projectPath, "main.js"), "export const x = 42;", "utf8");
      await orchestrator.execute({
        id: "00000000-0000-4000-8000-000000000070",
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: "00000000-0000-4000-8000-000000000071", path: projectPath },
      });

      const replayed = orchestrator.replay();
      expect(replayed.status).toBe(ProjectStatus.COMPLETED);
      expect(replayed.metadata.analysisStatus).toBe("completed");
      expect(replayed.metadata.analysisRunId).toBe("00000000-0000-4000-8000-000000000070");
      expect(replayed.metadata.discoveryStatus).toBe("completed");
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });
});

class FailingSymbolExtractor extends JavaScriptSymbolExtractor {
  public override extract(ast: Parameters<JavaScriptSymbolExtractor["extract"]>[0]): ReturnType<JavaScriptSymbolExtractor["extract"]> {
    if (ast.metadata.sourcePath === "bad.js") throw new LegacyExodusError({ code: "SYMBOL_EXTRACTION_FAILED", message: "Synthetic extraction failure." });
    return super.extract(ast);
  }
}

function createFailingParser(): Parser {
  return {
    id: "failing-javascript-parser",
    name: "Failing JavaScript Parser",
    version: "1.0.0",
    supportedLanguages: ["javascript"],
    capabilities: ["ast"],
    canHandle: (): boolean => true,
    async parse(): Promise<never> {
      throw new LegacyExodusError({ code: "SOURCE_PARSE_FAILED", message: "Synthetic parser failure." });
    },
  };
}
