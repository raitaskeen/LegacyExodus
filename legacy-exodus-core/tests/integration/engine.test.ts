import { describe, expect, test } from "bun:test";

import { createLegacyExodusEngine } from "@core/engine";

describe("LegacyExodusEngine integration", () => {
  test("composes, initializes, reports health, and shuts down", async (): Promise<void> => {
    const engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });

    await engine.initialize();

    const status = engine.status();

    expect(status.state).toBe("running");
    expect(status.runtime).toBe("running");
    expect(status.components).toEqual({
      events: "ready",
      plugins: "ready",
      storage: "ready",
    });

    await engine.shutdown();

    expect(engine.status().state).toBe("stopped");
  });
});
