import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EventBus } from "@core/events/event-bus";
import { InMemoryEventStore } from "@core/events/event-store";
import { Orchestrator } from "@core/orchestration/orchestrator";
import { DiscoveryEngine } from "@discovery/index";
import { JavaScriptParser, ParserManager, ParserRegistry } from "@parser/index";
import { JavaScriptSymbolExtractor } from "@symbols/index";
import { MemoryStorageProvider, StorageManager } from "@storage/index";

describe("Lookup-Map Key Canonicalization (CodeRabbit #3941957284)", () => {
  let tempDir: string;
  let projectPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "le-canonicalize-lookup-"));
    projectPath = join(tempDir, "workspace");
    const srcDir = join(projectPath, "src");
    await mkdir(srcDir, { recursive: true });

    await writeFile(
      join(srcDir, "dep.js"),
      "export function helper() { return 42; }\n",
      "utf8",
    );
    await writeFile(
      join(srcDir, "main.js"),
      'import { helper } from "./dep.js";\nfunction run() { helper(); }\n',
      "utf8",
    );
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { force: true, recursive: true });
    } catch {}
  });

  it("resolves cross-file calls when discovery paths contain non-canonical segments", async () => {
    const registry = new ParserRegistry();
    registry.register(new JavaScriptParser());
    const parserManager = new ParserManager(registry);
    const eventStore = new InMemoryEventStore();
    const eventBus = new EventBus();
    const storage = new StorageManager(new MemoryStorageProvider());

    class NonCanonicalPathDiscoveryEngine extends DiscoveryEngine {
      public override async discover(context: any): Promise<any> {
        const result = await super.discover(context);
        return {
          ...result,
          files: result.files.map((file: any) => ({
            ...file,
            path: `./${file.path}`,
          })),
        };
      }
    }

    const orchestrator = new Orchestrator(
      eventStore,
      eventBus,
      storage,
      new NonCanonicalPathDiscoveryEngine(),
      undefined,
      parserManager,
      new JavaScriptSymbolExtractor(),
    );

    const execution = await orchestrator.execute({
      id: randomUUID(),
      type: "AnalyzeProject",
      createdAt: new Date(),
      payload: {
        projectId: randomUUID(),
        path: projectPath,
      },
    });

    const semanticRecord = execution.records.find((r) => r.type === "semantic-analysis");
    expect(semanticRecord).toBeDefined();
    const calls = (semanticRecord?.payload as any)?.calls ?? [];
    const helperCall = calls.find((c: any) => c.calleeName === "helper");
    expect(helperCall).toBeDefined();
    expect(helperCall.resolutionState).toBe("RESOLVED");
    expect(helperCall.targetSymbolId).toBeDefined();

    const dataFlowRecord = execution.records.find((r) => r.type === "data-flow-analysis");
    expect(dataFlowRecord).toBeDefined();
    const graphs = (dataFlowRecord?.payload as any)?.graphs ?? [];
    const mainGraph = graphs.find((g: any) => g.filePath.includes("main.js"));
    expect(mainGraph).toBeDefined();
    expect(mainGraph.callBindings.length).toBeGreaterThan(0);
    expect(mainGraph.callBindings[0].targetSymbolId).toBe(helperCall.targetSymbolId);
  });

  it("resolves cross-file calls and data-flow bindings when file paths contain Windows backslashes", async () => {
    if (process.platform !== "win32") {
      return;
    }

    const registry = new ParserRegistry();
    registry.register(new JavaScriptParser());
    const parserManager = new ParserManager(registry);
    const eventStore = new InMemoryEventStore();
    const eventBus = new EventBus();
    const storage = new StorageManager(new MemoryStorageProvider());

    class WindowsPathDiscoveryEngine extends DiscoveryEngine {
      public override async discover(context: any): Promise<any> {
        const result = await super.discover(context);
        return {
          ...result,
          files: result.files.map((file: any) => ({
            ...file,
            path: file.path.replaceAll("/", "\\"),
          })),
        };
      }
    }

    const orchestrator = new Orchestrator(
      eventStore,
      eventBus,
      storage,
      new WindowsPathDiscoveryEngine(),
      undefined,
      parserManager,
      new JavaScriptSymbolExtractor(),
    );

    const execution = await orchestrator.execute({
      id: randomUUID(),
      type: "AnalyzeProject",
      createdAt: new Date(),
      payload: {
        projectId: randomUUID(),
        path: projectPath,
      },
    });

    const semanticRecord = execution.records.find((r) => r.type === "semantic-analysis");
    expect(semanticRecord).toBeDefined();
    const calls = (semanticRecord?.payload as any)?.calls ?? [];
    const helperCall = calls.find((c: any) => c.calleeName === "helper");
    expect(helperCall).toBeDefined();
    expect(helperCall.resolutionState).toBe("RESOLVED");
    expect(helperCall.targetSymbolId).toBeDefined();

    const dataFlowRecord = execution.records.find((r) => r.type === "data-flow-analysis");
    expect(dataFlowRecord).toBeDefined();
    const graphs = (dataFlowRecord?.payload as any)?.graphs ?? [];
    const mainGraph = graphs.find((g: any) => g.filePath.includes("main.js"));
    expect(mainGraph).toBeDefined();
    expect(mainGraph.callBindings.length).toBeGreaterThan(0);
    expect(mainGraph.callBindings[0].targetSymbolId).toBe(helperCall.targetSymbolId);
  });
});
