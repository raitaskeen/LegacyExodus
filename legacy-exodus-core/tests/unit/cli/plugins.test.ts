import { describe, expect, test } from "bun:test";

import { getPluginListReport } from "@cli/commands/plugins";

describe("plugins list command", () => {
  test("reports an empty registry for a fresh runtime", async (): Promise<void> => {
    const report = await getPluginListReport();

    expect(report.plugins).toEqual([]);
  });
});
