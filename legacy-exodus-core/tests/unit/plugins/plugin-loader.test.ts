import { describe, expect, test } from "bun:test";

import {
  InvalidPluginManifestError,
  PluginLoader,
  PluginRegistry,
  type LegacyExodusPlugin,
} from "@plugins/index";

describe("PluginLoader", () => {
  test("validates, registers, and initializes a plugin", async (): Promise<void> => {
    const registry = new PluginRegistry();
    const loader = new PluginLoader(registry);
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
    expect(receivedContext).toEqual({});
    expect(Object.isFrozen(receivedContext)).toBe(true);
  });

  test("rejects invalid manifests before initialization", async (): Promise<void> => {
    const registry = new PluginRegistry();
    const loader = new PluginLoader(registry);
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
