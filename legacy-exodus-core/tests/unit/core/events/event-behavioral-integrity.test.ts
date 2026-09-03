import { describe, expect, it } from "bun:test";
import { EventBus } from "../../../../src/core/events/event-bus";
import { createDomainEvent, type DomainEvent } from "../../../../src/core/events/domain-event";
import { InMemoryEventStore } from "../../../../src/core/events/event-store";
import { reduceProjectState } from "../../../../src/core/events/event-reducer";
import { createProjectState } from "../../../../src/core/state/state-factory";
import { ProjectStatus } from "../../../../src/core/state/project-state";

describe("EventBus & EventReducer Behavioral Integrity", () => {
  describe("EventBus Behavioral Contract", () => {
    it("Scenario 1: publishes events synchronously to subscribers in registration order", () => {
      const bus = new EventBus();
      const log: string[] = [];
      const event = createDomainEvent({
        type: "TestEvent",
        aggregateId: "p1",
        payload: { data: 123 },
      });

      bus.subscribe("TestEvent", () => log.push("subscriber 1"));
      bus.subscribe("TestEvent", () => log.push("subscriber 2"));
      bus.subscribe("TestEvent", () => log.push("subscriber 3"));

      bus.publish(event);

      expect(log).toEqual(["subscriber 1", "subscriber 2", "subscriber 3"]);
    });

    it("Scenario 2: supports duplicate subscriptions with independent delivery", () => {
      const bus = new EventBus();
      let callCount = 0;
      const handler = () => {
        callCount++;
      };

      const unsub1 = bus.subscribe("TestEvent", handler);
      const unsub2 = bus.subscribe("TestEvent", handler);

      const event = createDomainEvent({
        type: "TestEvent",
        aggregateId: "p1",
        payload: {},
      });

      bus.publish(event);
      expect(callCount).toBe(2);

      // Unsubscribing one removes only one instance
      unsub1();
      bus.publish(event);
      expect(callCount).toBe(3);

      // Unsubscribing second removes remaining instance
      unsub2();
      bus.publish(event);
      expect(callCount).toBe(3);
    });

    it("Scenario 3: handles unsubscribe during active dispatch without skipping subsequent handlers", () => {
      const bus = new EventBus();
      const executed: string[] = [];

      let unsub1: (() => void) | undefined;
      unsub1 = bus.subscribe("MutatingEvent", () => {
        executed.push("handler 1");
        // Unsubscribe self during dispatch
        unsub1?.();
      });

      bus.subscribe("MutatingEvent", () => {
        executed.push("handler 2");
      });

      bus.subscribe("MutatingEvent", () => {
        executed.push("handler 3");
      });

      const event = createDomainEvent({
        type: "MutatingEvent",
        aggregateId: "p1",
        payload: {},
      });

      // First publish should execute all 3 handlers despite handler 1 unsubscribing
      bus.publish(event);
      expect(executed).toEqual(["handler 1", "handler 2", "handler 3"]);

      // Second publish should only execute handler 2 and handler 3
      executed.length = 0;
      bus.publish(event);
      expect(executed).toEqual(["handler 2", "handler 3"]);
    });

    it("Scenario 3B: handles subscribe during active dispatch without executing new handler in the current cycle", () => {
      const bus = new EventBus();
      const executed: string[] = [];

      bus.subscribe("RegisteringEvent", () => {
        executed.push("handler 1");
        // Subscribe new handler during active dispatch
        bus.subscribe("RegisteringEvent", () => {
          executed.push("handler dynamically added");
        });
      });

      bus.subscribe("RegisteringEvent", () => {
        executed.push("handler 2");
      });

      const event = createDomainEvent({
        type: "RegisteringEvent",
        aggregateId: "p1",
        payload: {},
      });

      // First publish should execute only handler 1 and handler 2 (not dynamically added handler)
      bus.publish(event);
      expect(executed).toEqual(["handler 1", "handler 2"]);

      // Second publish should execute handler 1, handler 2, and the dynamically added handler
      executed.length = 0;
      bus.publish(event);
      expect(executed).toEqual(["handler 1", "handler 2", "handler dynamically added"]);
    });

    it("Scenario 3C: handles reentrant publish deterministically", () => {
      const bus = new EventBus();
      const order: string[] = [];

      bus.subscribe("OuterEvent", () => {
        order.push("outer:start");
        const innerEvent = createDomainEvent({
          type: "InnerEvent",
          aggregateId: "p1",
          payload: {},
        });
        bus.publish(innerEvent);
        order.push("outer:end");
      });

      bus.subscribe("InnerEvent", () => {
        order.push("inner:handled");
      });

      const outer = createDomainEvent({
        type: "OuterEvent",
        aggregateId: "p1",
        payload: {},
      });

      bus.publish(outer);
      expect(order).toEqual(["outer:start", "inner:handled", "outer:end"]);
    });

    it("Scenario 4: propagates subscriber exceptions synchronously and halts execution", () => {
      const bus = new EventBus();
      const afterExecuted: string[] = [];

      bus.subscribe("FailingEvent", () => {
        throw new Error("Subscriber failure");
      });

      bus.subscribe("FailingEvent", () => {
        afterExecuted.push("should not run");
      });

      const event = createDomainEvent({
        type: "FailingEvent",
        aggregateId: "p1",
        payload: {},
      });

      expect(() => bus.publish(event)).toThrow("Subscriber failure");
      expect(afterExecuted).toHaveLength(0);
    });

    it("Scenario 5: unsubscribe callback is idempotent", () => {
      const bus = new EventBus();
      let callCount = 0;
      const unsub = bus.subscribe("TestEvent", () => {
        callCount++;
      });

      unsub();
      // Second call to unsub should be completely safe
      expect(() => unsub()).not.toThrow();

      const event = createDomainEvent({
        type: "TestEvent",
        aggregateId: "p1",
        payload: {},
      });
      bus.publish(event);
      expect(callCount).toBe(0);
    });
  });

  describe("EventStore Behavioral Contract", () => {
    it("Scenario 6: maintains strict FIFO append order and exact filtering", () => {
      const store = new InMemoryEventStore();
      const e1 = createDomainEvent({ type: "EventA", aggregateId: "p1", payload: { seq: 1 } });
      const e2 = createDomainEvent({ type: "EventB", aggregateId: "p1", payload: { seq: 2 } });
      const e3 = createDomainEvent({ type: "EventA", aggregateId: "p2", payload: { seq: 3 } });

      store.append(e1);
      store.append(e2);
      store.append(e3);

      expect(store.size()).toBe(3);
      expect(store.getAll()).toEqual([e1, e2, e3]);
      expect(store.getByType("EventA")).toEqual([e1, e3]);
      expect(store.getByType("EventB")).toEqual([e2]);
      expect(store.getByType("EventC")).toEqual([]);

      store.clear();
      expect(store.size()).toBe(0);
      expect(store.getAll()).toEqual([]);
    });

    it("Scenario 7: getAll returns defensive copy of event array", () => {
      const store = new InMemoryEventStore();
      const e1 = createDomainEvent({ type: "EventA", aggregateId: "p1", payload: {} });
      store.append(e1);

      const eventsCopy = store.getAll() as DomainEvent[];
      expect(eventsCopy).toHaveLength(1);

      // Mutating the returned array must not mutate the store
      eventsCopy.pop();
      expect(store.size()).toBe(1);
      expect(store.getAll()).toHaveLength(1);
    });
  });

  describe("EventReducer Behavioral Contract", () => {
    it("Scenario 8: returns initial state unmodified when events list is empty", () => {
      const initial = createProjectState("Empty Project");
      const result = reduceProjectState(initial, []);

      expect(result).toBe(initial);
      expect(result.name).toBe("Empty Project");
      expect(result.version).toBe(0);
    });

    it("Scenario 9: reduces full event lifecycle deterministically", () => {
      const projectId = "proj-100";
      const initial = createProjectState("Placeholder");

      const events: DomainEvent[] = [
        createDomainEvent({
          type: "ProjectInitialized",
          aggregateId: projectId,
          payload: { projectId, name: "Production Gateway" },
        }),
        createDomainEvent({
          type: "FileDiscovered",
          aggregateId: projectId,
          payload: { fileId: "f1", path: "src/index.js", language: "javascript" },
        }),
        createDomainEvent({
          type: "FileDiscovered",
          aggregateId: projectId,
          payload: { fileId: "f2", path: "src/utils.js", language: "javascript" },
        }),
        createDomainEvent({
          type: "DependencyDetected",
          aggregateId: projectId,
          payload: { name: "express", version: "^4.21.2" },
        }),
        createDomainEvent({
          type: "FrameworkDetected",
          aggregateId: projectId,
          payload: { name: "express", evidence: "package.json dependencies" },
        }),
        createDomainEvent({
          type: "KnowledgeUpdated",
          aggregateId: projectId,
          payload: { artifactId: "art-1" },
        }),
        createDomainEvent({
          type: "DiscoveryCompleted",
          aggregateId: projectId,
          payload: { projectId, fileCount: 2, dependencyCount: 1, frameworkCount: 1 },
        }),
      ];

      const state = reduceProjectState(initial, events);

      expect(state.id).toBe(projectId);
      expect(state.name).toBe("Production Gateway");
      expect(state.version).toBe(7);
      expect(state.status).toBe(ProjectStatus.ANALYZING);
      expect(state.metadata.discoveredFileCount).toBe("2");
      expect(state.metadata.dependencyCount).toBe("1");
      expect(state.metadata.frameworkCount).toBe("1");
      expect(state.metadata.discoveryStatus).toBe("completed");
      expect(state.artifacts["art-1"]).toBeDefined();
      expect(state.artifacts["art-1"]?.type).toBe("knowledge");
      expect(Object.isFrozen(state)).toBe(true);
    });

    it("Scenario 10: replay is 100% deterministic and repeatable across multiple passes", () => {
      const projectId = "proj-deterministic";
      const initial = createProjectState("Init");

      const events: DomainEvent[] = [
        createDomainEvent({
          type: "ProjectInitialized",
          aggregateId: projectId,
          payload: { projectId, name: "Det System" },
        }),
        createDomainEvent({
          type: "FileDiscovered",
          aggregateId: projectId,
          payload: { fileId: "f1", path: "a.js", language: "javascript" },
        }),
        createDomainEvent({
          type: "KnowledgeUpdated",
          aggregateId: projectId,
          payload: { artifactId: "k1" },
        }),
      ];

      const state1 = reduceProjectState(initial, events);
      const state2 = reduceProjectState(initial, events);

      expect(state1.id).toBe(state2.id);
      expect(state1.name).toBe(state2.name);
      expect(state1.version).toBe(state2.version);
      expect(state1.status).toBe(state2.status);
      expect(state1.metadata).toEqual(state2.metadata);
      expect(state1.artifacts).toEqual(state2.artifacts);
    });

    it("Scenario 11: unknown event types leave state unmutated and do not throw", () => {
      const initial = createProjectState("Known System");
      const unknownEvent = createDomainEvent({
        type: "FuturePluginEvent",
        aggregateId: initial.id,
        payload: { unknownData: true },
      });

      const nextState = reduceProjectState(initial, [unknownEvent]);

      expect(nextState).toBe(initial);
      expect(nextState.version).toBe(initial.version);
      expect(nextState.status).toBe(initial.status);
    });

    it("Scenario 12: preserves state immutability (prior state objects remain untouched)", () => {
      const initial = createProjectState("Immutable App");
      const initEvent = createDomainEvent({
        type: "ProjectInitialized",
        aggregateId: "p1",
        payload: { projectId: "p1", name: "New Name" },
      });

      const state1 = reduceProjectState(initial, [initEvent]);

      expect(initial.name).toBe("Immutable App");
      expect(initial.version).toBe(0);
      expect(initial.id).not.toBe("p1");
      expect(state1.name).toBe("New Name");
      expect(state1.version).toBe(1);

      // Verify that mutating attempts on state fail / throw in frozen objects
      expect(() => {
        (state1 as { name: string }).name = "Illegal Mutation";
      }).toThrow();
    });

    it("Scenario 13: event ordering determines the final state sequence", () => {
      const projectId = "proj-ordered";
      const initial = createProjectState("Initial");

      const initEvent = createDomainEvent({
        type: "ProjectInitialized",
        aggregateId: projectId,
        payload: { projectId, name: "Name A" },
      });

      const fileEvent = createDomainEvent({
        type: "FileDiscovered",
        aggregateId: projectId,
        payload: { fileId: "f1", path: "src/a.js", language: "javascript" },
      });

      // Order 1: Init then File -> Status: DISCOVERING
      const state1 = reduceProjectState(initial, [initEvent, fileEvent]);
      expect(state1.status).toBe(ProjectStatus.DISCOVERING);

      // Order 2: File then Init -> Status: INITIALIZED (Init overwrote DISCOVERING)
      const state2 = reduceProjectState(initial, [fileEvent, initEvent]);
      expect(state2.status).toBe(ProjectStatus.INITIALIZED);
    });

    it("Scenario 14: AnalysisRunCompleted transitions project state to COMPLETED with analysis metadata (EVT-01)", () => {
      const projectId = "proj-completed";
      const initial = createProjectState("Init");

      const events: DomainEvent[] = [
        createDomainEvent({
          type: "ProjectInitialized",
          aggregateId: projectId,
          payload: { projectId, name: "System Complete" },
        }),
        createDomainEvent({
          type: "DiscoveryCompleted",
          aggregateId: projectId,
          payload: { projectId, fileCount: 5, dependencyCount: 2, frameworkCount: 1 },
        }),
        createDomainEvent({
          type: "AnalysisRunCompleted",
          aggregateId: projectId,
          payload: { projectId, analysisRunId: "run-complete-1", durationMs: 250 },
        }),
      ];

      const state = reduceProjectState(initial, events);

      expect(state.status).toBe(ProjectStatus.COMPLETED);
      expect(state.version).toBe(3);
      expect(state.metadata.analysisStatus).toBe("completed");
      expect(state.metadata.analysisRunId).toBe("run-complete-1");
      expect(state.metadata.analysisDurationMs).toBe("250");
      expect(Object.isFrozen(state)).toBe(true);
    });

    it("Scenario 15: AnalysisRunFailed transitions project state to FAILED with error metadata (EVT-01)", () => {
      const projectId = "proj-failed";
      const initial = createProjectState("Init");

      const events: DomainEvent[] = [
        createDomainEvent({
          type: "ProjectInitialized",
          aggregateId: projectId,
          payload: { projectId, name: "System Failed" },
        }),
        createDomainEvent({
          type: "DiscoveryCompleted",
          aggregateId: projectId,
          payload: { projectId, fileCount: 5, dependencyCount: 2, frameworkCount: 1 },
        }),
        createDomainEvent({
          type: "AnalysisRunFailed",
          aggregateId: projectId,
          payload: { projectId, analysisRunId: "run-failed-1", error: "Syntax error in parser" },
        }),
      ];

      const state = reduceProjectState(initial, events);

      expect(state.status).toBe(ProjectStatus.FAILED);
      expect(state.version).toBe(3);
      expect(state.metadata.analysisStatus).toBe("failed");
      expect(state.metadata.analysisRunId).toBe("run-failed-1");
      expect(state.metadata.analysisError).toBe("Syntax error in parser");
      expect(Object.isFrozen(state)).toBe(true);
    });

    it("Scenario 16: AnalysisRunCompleted clears stale analysisError from previous failed run (EVENT-01)", () => {
      const projectId = "proj-recovery";
      const initial = createProjectState("Init");

      const events: DomainEvent[] = [
        createDomainEvent({
          type: "ProjectInitialized",
          aggregateId: projectId,
          payload: { projectId, name: "Recovery System" },
        }),
        createDomainEvent({
          type: "DiscoveryCompleted",
          aggregateId: projectId,
          payload: { projectId, fileCount: 8, dependencyCount: 3, frameworkCount: 1 },
        }),
        createDomainEvent({
          type: "AnalysisRunFailed",
          aggregateId: projectId,
          payload: { projectId, analysisRunId: "run-failed-1", error: "Fatal parser crash" },
        }),
        createDomainEvent({
          type: "AnalysisRunCompleted",
          aggregateId: projectId,
          payload: { projectId, analysisRunId: "run-recovered-2", durationMs: 350 },
        }),
      ];

      const state = reduceProjectState(initial, events);

      expect(state.status).toBe(ProjectStatus.COMPLETED);
      expect(state.version).toBe(4);
      expect(state.metadata.analysisStatus).toBe("completed");
      expect(state.metadata.analysisRunId).toBe("run-recovered-2");
      expect(state.metadata.analysisDurationMs).toBe("350");

      // Critical assertion: stale analysisError must be completely cleared from metadata
      expect("analysisError" in state.metadata).toBe(false);
      expect(state.metadata.analysisError).toBeUndefined();

      // Cumulative discovery metadata remains preserved
      expect(state.metadata.discoveryStatus).toBe("completed");
      expect(state.metadata.discoveredFileCount).toBe("8");
      expect(state.metadata.dependencyCount).toBe("3");
      expect(state.metadata.frameworkCount).toBe("1");

      expect(Object.isFrozen(state)).toBe(true);
      expect(Object.isFrozen(state.metadata)).toBe(true);
    });

    it("Scenario 17: Replay equivalence for recovery sequence (EVENT-01)", () => {
      const projectId = "proj-replay";
      const initial = createProjectState("Init");

      const events: DomainEvent[] = [
        createDomainEvent({
          type: "ProjectInitialized",
          aggregateId: projectId,
          payload: { projectId, name: "Replay System" },
        }),
        createDomainEvent({
          type: "DiscoveryCompleted",
          aggregateId: projectId,
          payload: { projectId, fileCount: 2, dependencyCount: 1, frameworkCount: 0 },
        }),
        createDomainEvent({
          type: "AnalysisRunFailed",
          aggregateId: projectId,
          payload: { projectId, analysisRunId: "run-failed", error: "Temporary failure" },
        }),
        createDomainEvent({
          type: "AnalysisRunCompleted",
          aggregateId: projectId,
          payload: { projectId, analysisRunId: "run-success", durationMs: 120 },
        }),
      ];

      const run1State = reduceProjectState(initial, events);
      const replayedState = reduceProjectState(createProjectState("Init"), events);

      expect(replayedState).toEqual(run1State);
      expect("analysisError" in replayedState.metadata).toBe(false);
      expect(replayedState.metadata.analysisStatus).toBe("completed");
      expect(replayedState.status).toBe(ProjectStatus.COMPLETED);
    });
  });
});
