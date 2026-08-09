import type { EventBus } from "@core/events/event-bus";
import type { InMemoryEventStore } from "@core/events/event-store";
import type { Orchestrator } from "@core/orchestration/orchestrator";
import type { PluginRegistry } from "@plugins/index";
import type { ParserManager, ParserRegistry } from "@parser/index";
import type { ApplicationRuntime } from "@runtime/application";
import type { StorageManager } from "@storage/index";
import type { DiscoveryProjectionService } from "@storage/index";

export interface EngineContext {
  readonly runtime: ApplicationRuntime;
  readonly eventStore: InMemoryEventStore;
  readonly eventBus: EventBus;
  readonly storage: StorageManager;
  readonly discoveryProjection: DiscoveryProjectionService;
  readonly plugins: PluginRegistry;
  readonly parserRegistry: ParserRegistry;
  readonly parserManager: ParserManager;
  readonly orchestrator: Orchestrator;
}
