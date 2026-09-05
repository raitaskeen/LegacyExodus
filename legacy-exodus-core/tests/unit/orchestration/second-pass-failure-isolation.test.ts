import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EventBus } from "@core/events/event-bus";
import { InMemoryEventStore } from "@core/events/event-store";
import { Orchestrator } from "@core/orchestration/orchestrator";
import { DiscoveryEngine } from "@discovery/index";
import { JavaScriptParser, ParserManager, ParserRegistry, type ASTResult } from "@parser/index";
import { JavaScriptSymbolExtractor } from "@symbols/index";
import { MemoryStorageProvider, StorageManager } from "@storage/index";

describe("Second-Pass Parse Failure Isolation (CodeRabbit #3)", () => {
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
      "export function func2() { return 2; }\n",
      "utf8",
    );
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { force: true, recursive: true });
    } catch {}
  });

  it("isolates second-pass parse failure to a ParserFailure event and completes run", async () => {
    const registry = new ParserRegistry();
    registry.register(new JavaScriptParser());

    let parseCountForFile2 = 0;

    class FaultInjectingParserManager extends ParserManager {
      public override async parse(request: any): Promise<ASTResult> {
        if (request.file.path.includes("file2.js")) {
          parseCountForFile2++;
          // Fail on the second pass
          if (parseCountForFile2 > 1) {
            throw new Error("Simulated second-pass transient I/O or parser crash");
          }
        }
        return super.parse(request);
      }
    }

    const faultParserManager = new FaultInjectingParserManager(registry);
    const eventStore = new InMemoryEventStore();
    const eventBus = new EventBus();
    const storage = new StorageManager(new MemoryStorageProvider());

    const orchestrator = new Orchestrator(
      eventStore,
      eventBus,
      storage,
      new DiscoveryEngine(),
      undefined,
      faultParserManager,
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

    const eventTypes = execution.events.map((e) => e.type);

    // Fault isolation invariant:
    // 1. Emits ParserFailure for the failing file in second pass
    expect(eventTypes).toContain("ParserFailure");

    // 2. Does NOT crash the entire run into AnalysisRunFailed
    expect(eventTypes).not.toContain("AnalysisRunFailed");

    // 3. Completes the analysis run for healthy files
    expect(eventTypes).toContain("AnalysisRunCompleted");
  });
});
