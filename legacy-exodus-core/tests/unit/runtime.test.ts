import { describe, expect, test } from "bun:test";

import { createEngineContext } from "@runtime/composition/services";
import { loadRuntimeConfig } from "@runtime/config";
import { ConfigurationError, LegacyExodusError } from "@shared/errors";

describe("runtime foundation", () => {
  test("rejects an unsupported runtime environment", (): void => {
    expect(() => loadRuntimeConfig({ NODE_ENV: "staging" })).toThrow(ConfigurationError);
  });

  test("initializes and shuts down deterministically", async (): Promise<void> => {
    const runtime = createEngineContext({
      LOG_LEVEL: "silent",
      NODE_ENV: "test",
    }).runtime;

    expect(runtime.getStatus()).toBe("created");
    await runtime.start();
    expect(runtime.getStatus()).toBe("running");
    await runtime.shutdown();
    expect(runtime.getStatus()).toBe("stopped");
  });

  test("preserves error code, message, and metadata", (): void => {
    const error = new LegacyExodusError({
      code: "TEST_ERROR",
      message: "Test failure",
      metadata: { source: "unit-test" },
    });

    expect(error.code).toBe("TEST_ERROR");
    expect(error.message).toBe("Test failure");
    expect(error.metadata).toEqual({ source: "unit-test" });
  });
});
