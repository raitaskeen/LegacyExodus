import { describe, expect, test } from "bun:test";

import { EventBus } from "@core/events/event-bus";
import {
  InvalidPluginManifestError,
  PluginLoader,
  PluginRegistry,
  type LegacyExodusPlugin,
} from "@plugins/index";
import { createLogger } from "@shared/logger";
import { MemoryStorageProvider, StorageManager } from "@storage/index";

function createContext(): {
  readonly eventBus: EventBus;
  readonly logger: ReturnType<typeof createLogger>;
  readonly storage: StorageManager;
} {
  return {
    eventBus: new EventBus(),
    logger: createLogger({ environment: "test", logLevel: "silent", storageDriver: "memory" }, "plugin-test"),
    storage: new StorageManager(new MemoryStorageProvider()),
  };
}

describe("PluginLoader", () => {
  test("validates, registers, and initializes a plugin", async (): Promise<void> => {
    const registry = new PluginRegistry();
    const context = createContext();
    const loader = new PluginLoader(registry, context);
    let receivedContext: unknown;
    const plugin: LegacyExodusPlugin = {
      id: "valid-plugin",
      name: "Valid Plugin",
      version: "1.0.0",
      type: "validator",
      initialize: async (pluginContext): Promise<void> => {
        receivedContext = pluginContext;
      },
      shutdown: async (): Promise<void> => undefined,
    };

    await loader.load(plugin);

    expect(registry.get(plugin.id)).toBe(plugin);
    expect(receivedContext).toBe(context);
  });

  test("rejects invalid manifests before initialization", async (): Promise<void> => {
    const registry = new PluginRegistry();
    const loader = new PluginLoader(registry, createContext());
    let initialized = false;
    const plugin: LegacyExodusPlugin = {
      id: "",
      name: "Invalid Plugin",
      version: "1.0.0",
      type: "parser",
      initialize: async (): Promise<void> => {
        initialized = true;
      },
      shutdown: async (): Promise<void> => undefined,
    };

    await expect(loader.load(plugin)).rejects.toThrow(InvalidPluginManifestError);
    expect(initialized).toBe(false);
    expect(registry.list()).toEqual([]);
  });
});
