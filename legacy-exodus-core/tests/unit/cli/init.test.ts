import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, test } from "bun:test";

import { CLI_VERSION } from "@cli/app";
import { initializeWorkspace } from "@cli/commands/init";

describe("init command", () => {
  test("creates workspace metadata without analyzing project files", async (): Promise<void> => {
    const workspace = await mkdtemp(join(tmpdir(), "legacy-exodus-cli-"));

    try {
      const report = await initializeWorkspace(workspace, CLI_VERSION);
      const metadata = JSON.parse(await readFile(report.metadataPath, "utf8")) as {
        createdAt: string;
        projectState: string;
        version: string;
      };

      expect(metadata.version).toBe(CLI_VERSION);
      expect(metadata.projectState).toBe("initialized");
      expect(typeof metadata.createdAt).toBe("string");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
