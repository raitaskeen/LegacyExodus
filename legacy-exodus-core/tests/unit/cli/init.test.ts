import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
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
        projectId: string;
        projectState: string;
        version: string;
      };

      expect(metadata.version).toBe(CLI_VERSION);
      expect(metadata.projectState).toBe("initialized");
      expect(metadata.projectId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(typeof metadata.createdAt).toBe("string");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  test("rejects a redirected metadata root without modifying its external target", async (): Promise<void> => {
    const root = await mkdtemp(join(tmpdir(), "legacy-exodus-cli-containment-"));
    const workspace = join(root, "project");
    const externalDirectory = join(root, "external");
    const metadataDirectory = join(workspace, ".legacy-exodus");
    const externalConfigPath = join(externalDirectory, "config.json");
    const sentinelPath = join(externalDirectory, "sentinel.txt");

    await mkdir(workspace, { recursive: true });
    await mkdir(externalDirectory, { recursive: true });
    await writeFile(sentinelPath, "external-sentinel", "utf8");
    await symlink(externalDirectory, metadataDirectory, process.platform === "win32" ? "junction" : "dir");

    let rejection: unknown;
    try {
      await initializeWorkspace(workspace, CLI_VERSION);
    } catch (error: unknown) {
      rejection = error;
    }

    try {
      expect(existsSync(externalConfigPath)).toBe(false);
      expect(await readFile(sentinelPath, "utf8")).toBe("external-sentinel");
      expect(rejection).toMatchObject({
        code: "WORKSPACE_METADATA_UNSAFE",
        message: "The LegacyExodus metadata path is not a safe directory.",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("rejects a metadata root that is not a directory", async (): Promise<void> => {
    const workspace = await mkdtemp(join(tmpdir(), "legacy-exodus-cli-metadata-file-"));
    const metadataPath = join(workspace, ".legacy-exodus");
    await writeFile(metadataPath, "metadata-sentinel", "utf8");

    try {
      await expect(initializeWorkspace(workspace, CLI_VERSION)).rejects.toMatchObject({
        code: "WORKSPACE_METADATA_UNSAFE",
        message: "The LegacyExodus metadata path is not a safe directory.",
      });
      expect(await readFile(metadataPath, "utf8")).toBe("metadata-sentinel");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  test.skipIf(process.platform === "win32")(
    "rejects a redirected config file without modifying its external target (file symlinks require Windows privilege)",
    async (): Promise<void> => {
      const root = await mkdtemp(join(tmpdir(), "legacy-exodus-cli-config-containment-"));
      const workspace = join(root, "project");
      const metadataDirectory = join(workspace, ".legacy-exodus");
      const externalConfigPath = join(root, "external-config.json");
      const configPath = join(metadataDirectory, "config.json");

      await mkdir(metadataDirectory, { recursive: true });
      await writeFile(externalConfigPath, "external-config-sentinel", "utf8");
      await symlink(externalConfigPath, configPath, "file");

      try {
        await expect(initializeWorkspace(workspace, CLI_VERSION)).rejects.toMatchObject({
          code: "WORKSPACE_METADATA_UNSAFE",
          message: "The LegacyExodus metadata path is not a safe directory.",
        });
        expect(await readFile(externalConfigPath, "utf8")).toBe("external-config-sentinel");
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );

  test("rejects a redirected config junction without modifying its external target", async (): Promise<void> => {
    const root = await mkdtemp(join(tmpdir(), "legacy-exodus-cli-config-junction-"));
    const workspace = join(root, "project");
    const metadataDirectory = join(workspace, ".legacy-exodus");
    const externalDirectory = join(root, "external");
    const sentinelPath = join(externalDirectory, "sentinel.txt");
    const configPath = join(metadataDirectory, "config.json");

    await mkdir(metadataDirectory, { recursive: true });
    await mkdir(externalDirectory, { recursive: true });
    await writeFile(sentinelPath, "external-config-sentinel", "utf8");
    await symlink(externalDirectory, configPath, process.platform === "win32" ? "junction" : "dir");

    try {
      await expect(initializeWorkspace(workspace, CLI_VERSION)).rejects.toMatchObject({
        code: "WORKSPACE_METADATA_UNSAFE",
        message: "The LegacyExodus metadata path is not a safe directory.",
      });
      expect(await readFile(sentinelPath, "utf8")).toBe("external-config-sentinel");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
