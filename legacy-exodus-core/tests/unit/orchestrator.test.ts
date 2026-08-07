import { describe, expect, test } from "bun:test";

import type { InitializeProjectCommand } from "@contracts/commands";
import { InMemoryEventStore } from "@core/events/event-store";
import { Orchestrator } from "@core/orchestration/orchestrator";

describe("Orchestrator", () => {
  test("handles an initialization command and stores its event", (): void => {
    const eventStore = new InMemoryEventStore();
    const orchestrator = new Orchestrator(eventStore);
    const command: InitializeProjectCommand = {
      id: "00000000-0000-4000-8000-000000000010",
      type: "InitializeProject",
      createdAt: new Date(),
      payload: {
        projectId: "00000000-0000-4000-8000-000000000011",
        name: "Legacy inventory system",
      },
    };

    const event = orchestrator.execute(command);

    expect(event.type).toBe("ProjectInitialized");
    expect(eventStore.getAll()).toEqual([event]);
    expect(orchestrator.replay().name).toBe("Legacy inventory system");
    expect(orchestrator.getStatus()).toBe("idle");
  });
});
