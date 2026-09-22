import { describe, expect, test } from "bun:test";

import type { PluginContext } from "@plugins/plugin-context";
import type { LegacyExodusPlugin } from "@plugins/plugin";
import { createEngineContext } from "@runtime/composition/services";

type RawInfrastructureKey = Extract<keyof PluginContext, "eventBus" | "storage">;

describe("Plugin capability boundary", () => {
  test("initializes plugins without exposing raw host infrastructure", async (): Promise<void> => {
    const engineContext = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    let receivedContext: PluginContext | undefined;
    let initialized = false;
    const rawInfrastructureExcluded: [RawInfrastructureKey] extends [never] ? true : false = true;
    const plugin: LegacyExodusPlugin = {
      id: "capability-boundary-plugin",
      name: "Capability Boundary Plugin",
      version: "1.0.0",
      type: "validator",
      initialize: async (context): Promise<void> => {
        receivedContext = context;
        initialized = true;
      },
      shutdown: async (): Promise<void> => undefined,
    };

    try {
      await engineContext.runtime.getPluginLoader().load(plugin);

      if (receivedContext === undefined) {
        throw new Error("Plugin initialization did not receive a context.");
      }

      expect(initialized).toBe(true);
      expect(rawInfrastructureExcluded).toBe(true);
      expect(Reflect.ownKeys(receivedContext)).toEqual([]);
      expect(Object.isFrozen(receivedContext)).toBe(true);
      expect("eventBus" in receivedContext).toBe(false);
      expect("storage" in receivedContext).toBe(false);
      expect("logger" in receivedContext).toBe(false);
    } finally {
      await engineContext.storage.close();
    }
  });
});
