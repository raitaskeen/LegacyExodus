import { describe, expect, test } from "bun:test";

import type { InitializeProjectCommand } from "@contracts/commands";
import { EventBus } from "@core/events/event-bus";
import { InMemoryEventStore } from "@core/events/event-store";
import { Orchestrator } from "@core/orchestration/orchestrator";
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
});
