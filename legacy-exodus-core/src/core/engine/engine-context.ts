import type { EventBus } from "@core/events/event-bus";
import type { InMemoryEventStore } from "@core/events/event-store";
import type { Orchestrator } from "@core/orchestration/orchestrator";
import type { PluginRegistry } from "@plugins/index";
import type { ApplicationRuntime } from "@runtime/application";
import type { StorageManager } from "@storage/index";

export interface EngineContext {
  readonly runtime: ApplicationRuntime;
  readonly eventStore: InMemoryEventStore;
  readonly eventBus: EventBus;
  readonly storage: StorageManager;
  readonly plugins: PluginRegistry;
  readonly orchestrator: Orchestrator;
}
