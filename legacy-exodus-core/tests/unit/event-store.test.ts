import { describe, expect, test } from "bun:test";

import { EventBus } from "@core/events/event-bus";
import { createDomainEvent } from "@core/events/domain-event";
import { reduceProjectState } from "@core/events/event-reducer";
import { InMemoryEventStore } from "@core/events/event-store";
import { createProjectState } from "@core/state/state-factory";

describe("InMemoryEventStore", () => {
  test("appends events in order and supports retrieval and clearing", (): void => {
    const store = new InMemoryEventStore();
    const firstEvent = createDomainEvent({
      type: "ProjectInitialized",
      aggregateId: "project-123",
      payload: { projectId: "project-123", name: "Legacy system" },
    });
    const secondEvent = createDomainEvent({
      type: "FileDiscovered",
      aggregateId: "project-123",
      payload: { fileId: "file-123", path: "legacy.php", language: "PHP" },
    });

    store.append(firstEvent);
    store.append(secondEvent);

    expect(store.getAll()).toEqual([firstEvent, secondEvent]);
    expect(store.getByType("FileDiscovered")).toEqual([secondEvent]);
    expect(store.size()).toBe(2);

    store.clear();

    expect(store.size()).toBe(0);
  });
});

describe("EventBus", () => {
  test("publishes subscribers synchronously in registration order", (): void => {
    const bus = new EventBus();
    const receivedBy: string[] = [];
    const event = createDomainEvent({
      type: "ProjectInitialized",
      aggregateId: "project-123",
      payload: { projectId: "project-123", name: "Legacy system" },
    });

    bus.subscribe("ProjectInitialized", (): void => {
      receivedBy.push("first");
    });
    bus.subscribe("ProjectInitialized", (): void => {
      receivedBy.push("second");
    });

    bus.publish(event);

    expect(receivedBy).toEqual(["first", "second"]);
  });
});

describe("ProjectState event reducer", () => {
  test("replays supported event facts into a new project state", (): void => {
    const projectId = "00000000-0000-4000-8000-000000000001";
    const artifactId = "00000000-0000-4000-8000-000000000002";
    const state = reduceProjectState(createProjectState("placeholder"), [
      createDomainEvent({
        type: "ProjectInitialized",
        aggregateId: projectId,
        payload: { projectId, name: "Legacy system" },
      }),
      createDomainEvent({
        type: "FileDiscovered",
        aggregateId: projectId,
        payload: { fileId: "file-123", path: "legacy.php", language: "PHP" },
      }),
      createDomainEvent({
        type: "KnowledgeUpdated",
        aggregateId: projectId,
        payload: { artifactId },
      }),
    ]);

    expect(state.id).toBe(projectId);
    expect(state.name).toBe("Legacy system");
    expect(state.version).toBe(3);
    expect(state.metadata.discoveredFileCount).toBe("1");
    expect(state.artifacts[artifactId]?.type).toBe("knowledge");
  });
});
