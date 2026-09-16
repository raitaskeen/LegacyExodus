import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCLI } from "@cli/app";
import { ConfigurationError } from "@shared/errors";

describe("CLI storage option forwarding", () => {
  test("forwards explicit SQLite driver and database path through the composed CLI", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "legacy-exodus-cli-storage-"));
    const projectPath = join(workspace, "project");
    const databasePath = join(workspace, "analysis.sqlite");

    try {
      await mkdir(projectPath);
      await writeFile(
        join(projectPath, "package.json"),
        JSON.stringify({ name: "storage-forwarding-fixture", version: "1.0.0" }),
        "utf8",
      );

      const cli = createCLI();
      await cli.parseAsync(
        [
          "analyze",
          projectPath,
          "--json",
          "--storage-driver",
          "sqlite",
          "--storage-path",
          databasePath,
          "--refresh",
        ],
        { from: "user" },
      );

      expect(await Bun.file(databasePath).exists()).toBe(true);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("forwards storage path alone and preserves SQLite inference", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "legacy-exodus-cli-storage-path-"));
    const projectPath = join(workspace, "project");
    const databasePath = join(workspace, "inferred.sqlite");

    try {
      await mkdir(projectPath);
      await writeFile(
        join(projectPath, "package.json"),
        JSON.stringify({ name: "storage-path-fixture", version: "1.0.0" }),
        "utf8",
      );

      const cli = createCLI();
      await cli.parseAsync(
        ["analyze", projectPath, "--json", "--storage-path", databasePath],
        { from: "user" },
      );

      expect(await Bun.file(databasePath).exists()).toBe(true);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("preserves runtime validation for an unsupported storage driver", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "legacy-exodus-cli-storage-invalid-"));
    const projectPath = join(workspace, "project");

    try {
      await mkdir(projectPath);
      await writeFile(
        join(projectPath, "package.json"),
        JSON.stringify({ name: "invalid-storage-fixture", version: "1.0.0" }),
        "utf8",
      );

      const cli = createCLI();
      await expect(
        cli.parseAsync(
          ["analyze", projectPath, "--json", "--storage-driver", "unsupported"],
          { from: "user" },
        ),
      ).rejects.toBeInstanceOf(ConfigurationError);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
