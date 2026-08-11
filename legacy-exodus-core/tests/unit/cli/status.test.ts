import { describe, expect, test } from "bun:test";

import { CLI_VERSION } from "@cli/app";
import { getStatusReport } from "@cli/commands/status";

describe("status command", () => {
  test("reports a running runtime and composed dependencies", async (): Promise<void> => {
    const report = await getStatusReport(CLI_VERSION);

    expect(report.runtime).toBe("running");
    expect(report.storage).toBe("ready");
    expect(report.plugins).toBe(0);
    expect(report.version).toBe(CLI_VERSION);
  });
});
