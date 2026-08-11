import type { Logger } from "pino";

import type { EventBus } from "@core/events/event-bus";
import type { StorageManager } from "@storage/storage-manager";

export interface PluginContext {
  readonly logger: Logger;
  readonly eventBus: EventBus;
  readonly storage: StorageManager;
}
