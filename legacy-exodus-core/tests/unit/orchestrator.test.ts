import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, test } from "bun:test";

import type { InitializeProjectCommand } from "@contracts/commands";
import { EventBus } from "@core/events/event-bus";
import { InMemoryEventStore } from "@core/events/event-store";
import { Orchestrator } from "@core/orchestration/orchestrator";
import { DiscoveryEngine } from "@discovery/index";
import { ParserManager, ParserRegistry, type Parser } from "@parser/index";
import { LegacyExodusError } from "@shared/errors";
import { MemoryStorageProvider, StorageManager } from "@storage/index";

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
});

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
