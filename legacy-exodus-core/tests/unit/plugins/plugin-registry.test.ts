import { describe, expect, test } from "bun:test";

import {
  PluginAlreadyRegisteredError,
  PluginNotFoundError,
  PluginRegistry,
  type LegacyExodusPlugin,
} from "@plugins/index";

function createPlugin(id: string): LegacyExodusPlugin {
  return {
    id,
    name: "Test Plugin",
    version: "1.0.0",
    type: "validator",
    initialize: async (): Promise<void> => undefined,
    shutdown: async (): Promise<void> => undefined,
  };
}

describe("PluginRegistry", () => {
  test("registers, retrieves, and lists plugins", (): void => {
    const registry = new PluginRegistry();
    const plugin = createPlugin("test-plugin");

    registry.register(plugin);

    expect(registry.has(plugin.id)).toBe(true);
    expect(registry.get(plugin.id)).toBe(plugin);
    expect(registry.list()).toEqual([plugin]);
  });

  test("rejects duplicate plugin identifiers", (): void => {
    const registry = new PluginRegistry();

    registry.register(createPlugin("duplicate-plugin"));

    expect(() => registry.register(createPlugin("duplicate-plugin"))).toThrow(
      PluginAlreadyRegisteredError,
    );
    expect(() => registry.get("missing-plugin")).toThrow(PluginNotFoundError);
  });
});
