import { existsSync } from "node:fs";
import { link, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { createDiscoveryProjection, type DiscoveryProjection } from "@contracts/discovery-projection";
import { FileDiscoveryProjectionAdapter } from "@storage/index";

const temporaryRoots: string[] = [];

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "legacy-exodus-sec-001-"));
  temporaryRoots.push(root);
  return root;
}

async function removeRedirect(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // The redirect may already have been removed or may never have been created.
  }
}

function createProjection(projectPath: string) {
  return createDiscoveryProjection({
    projectPath,
    artifacts: [
      { name: "project.json", payload: { name: "contained-project" } },
      { name: "files.json", payload: [{ path: "src/index.ts" }] },
      { name: "summary.json", payload: { fileCount: 1 } },
    ],
  });
}

describe("SEC-001 discovery projection write containment", () => {
  afterEach(async (): Promise<void> => {
    for (const root of temporaryRoots.splice(0)) {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("rejects a redirected .discovery root before modifying its external target", async (): Promise<void> => {
    const root = await createTemporaryRoot();
    const projectPath = join(root, "project");
    const externalTarget = join(root, "external-target");
    const discoveryPath = join(projectPath, ".discovery");

    await mkdir(projectPath, { recursive: true });
    await mkdir(externalTarget, { recursive: true });
    await writeFile(join(externalTarget, "sentinel.txt"), "unchanged", "utf8");
    await symlink(externalTarget, discoveryPath, process.platform === "win32" ? "junction" : "dir");

    const projection = createProjection(projectPath);

    try {
      let rejection: unknown;
      try {
        await new FileDiscoveryProjectionAdapter().write(projection);
      } catch (error: unknown) {
        rejection = error;
      }

      expect(await readFile(join(externalTarget, "sentinel.txt"), "utf8")).toBe("unchanged");
      expect(existsSync(join(externalTarget, "project.json"))).toBe(false);
      expect(existsSync(join(externalTarget, "summary.json"))).toBe(false);
      expect(existsSync(join(externalTarget, "manifest.json"))).toBe(false);
      expect(rejection).toMatchObject({ code: "DISCOVERY_PROJECTION_PATH_UNSAFE" });
    } finally {
      await removeRedirect(discoveryPath);
    }
  });

  test("rejects a runtime-invalid traversal artifact before constructing its destination", async (): Promise<void> => {
    const root = await createTemporaryRoot();
    const projectPath = join(root, "project");
    const discoveryPath = join(projectPath, ".discovery");
    const outsidePath = join(projectPath, "outside.json");
    const sentinelPath = join(projectPath, "sentinel.txt");
    const safeArtifactPath = join(discoveryPath, "project.json");

    await mkdir(discoveryPath, { recursive: true });
    await writeFile(sentinelPath, "external-sentinel", "utf8");
    await writeFile(safeArtifactPath, "existing-safe-artifact", "utf8");

    const runtimeInvalidProjection = {
      projectPath,
      artifacts: [{ name: "../outside.json", payload: { escaped: true } }],
    } as unknown as DiscoveryProjection;

    let rejection: unknown;
    try {
      await new FileDiscoveryProjectionAdapter().write(runtimeInvalidProjection);
    } catch (error: unknown) {
      rejection = error;
    }

    expect(existsSync(outsidePath)).toBe(false);
    expect(await readFile(sentinelPath, "utf8")).toBe("external-sentinel");
    expect(await readFile(safeArtifactPath, "utf8")).toBe("existing-safe-artifact");
    expect(rejection).toMatchObject({ code: "DISCOVERY_PROJECTION_INVALID" });
  });

  test("rejects a redirected child artifact before modifying its external target", async (): Promise<void> => {
    const root = await createTemporaryRoot();
    const projectPath = join(root, "project");
    const discoveryPath = join(projectPath, ".discovery");
    const externalTarget = process.platform === "win32"
      ? join(root, "external-artifact-directory")
      : join(root, "external-files.json");
    const artifactPath = join(discoveryPath, "files.json");

    await mkdir(discoveryPath, { recursive: true });
    if (process.platform === "win32") {
      await mkdir(externalTarget, { recursive: true });
      await writeFile(join(externalTarget, "sentinel.txt"), "external-sentinel", "utf8");
      await symlink(externalTarget, artifactPath, "junction");
    } else {
      await writeFile(externalTarget, "external-sentinel", "utf8");
      await symlink(externalTarget, artifactPath, "file");
    }

    await writeFile(join(discoveryPath, "project.json"), "existing-project-artifact", "utf8");

    let rejection: unknown;
    try {
      try {
        await new FileDiscoveryProjectionAdapter().write(createProjection(projectPath));
      } catch (error: unknown) {
        rejection = error;
      }

      const externalSentinel = process.platform === "win32"
        ? await readFile(join(externalTarget, "sentinel.txt"), "utf8")
        : await readFile(externalTarget, "utf8");
      expect(externalSentinel).toBe("external-sentinel");
      expect(await readFile(join(discoveryPath, "project.json"), "utf8")).toBe("existing-project-artifact");
      expect(rejection).toMatchObject({ code: "DISCOVERY_PROJECTION_PATH_UNSAFE" });
    } finally {
      await removeRedirect(artifactPath);
    }
  });

  test("writes when .discovery is absent or an existing ordinary directory", async (): Promise<void> => {
    const root = await createTemporaryRoot();
    const projectPath = join(root, "project");
    const discoveryPath = join(projectPath, ".discovery");
    await mkdir(projectPath, { recursive: true });

    const adapter = new FileDiscoveryProjectionAdapter();
    const projection = createProjection(projectPath);

    await adapter.write(projection);
    expect(JSON.parse(await readFile(join(discoveryPath, "files.json"), "utf8"))).toEqual([
      { path: "src/index.ts" },
    ]);

    await adapter.write(projection);
    expect(JSON.parse(await readFile(join(discoveryPath, "project.json"), "utf8"))).toEqual({
      name: "contained-project",
    });
  });

  test("rejects a redirected manifest before replacing any safe artifact", async (): Promise<void> => {
    const root = await createTemporaryRoot();
    const projectPath = join(root, "project");
    const discoveryPath = join(projectPath, ".discovery");
    const externalTarget = process.platform === "win32"
      ? join(root, "external-manifest-directory")
      : join(root, "external-manifest.json");
    const manifestPath = join(discoveryPath, "manifest.json");

    await mkdir(discoveryPath, { recursive: true });
    await writeFile(join(discoveryPath, "project.json"), "existing-project-artifact", "utf8");
    if (process.platform === "win32") {
      await mkdir(externalTarget, { recursive: true });
      await writeFile(join(externalTarget, "sentinel.txt"), "external-manifest", "utf8");
      await symlink(externalTarget, manifestPath, "junction");
    } else {
      await writeFile(externalTarget, "external-manifest", "utf8");
      await symlink(externalTarget, manifestPath, "file");
    }

    let rejection: unknown;
    try {
      try {
        await new FileDiscoveryProjectionAdapter().write(createProjection(projectPath));
      } catch (error: unknown) {
        rejection = error;
      }

      const externalSentinel = process.platform === "win32"
        ? await readFile(join(externalTarget, "sentinel.txt"), "utf8")
        : await readFile(externalTarget, "utf8");
      expect(externalSentinel).toBe("external-manifest");
      expect(await readFile(join(discoveryPath, "project.json"), "utf8")).toBe("existing-project-artifact");
      expect(rejection).toMatchObject({ code: "DISCOVERY_PROJECTION_PATH_UNSAFE" });
    } finally {
      await removeRedirect(manifestPath);
    }
  });

  test("rejects a hard-linked artifact before a replacement fallback can modify external content", async (): Promise<void> => {
    const root = await createTemporaryRoot();
    const projectPath = join(root, "project");
    const discoveryPath = join(projectPath, ".discovery");
    const externalFile = join(root, "external-hard-link.json");
    const artifactPath = join(discoveryPath, "files.json");

    await mkdir(discoveryPath, { recursive: true });
    await writeFile(externalFile, "external-hard-link-sentinel", "utf8");
    await link(externalFile, artifactPath);
    await writeFile(join(discoveryPath, "project.json"), "existing-project-artifact", "utf8");

    let rejection: unknown;
    try {
      try {
        await new FileDiscoveryProjectionAdapter().write(createProjection(projectPath));
      } catch (error: unknown) {
        rejection = error;
      }

      expect(await readFile(externalFile, "utf8")).toBe("external-hard-link-sentinel");
      expect(await readFile(join(discoveryPath, "project.json"), "utf8")).toBe("existing-project-artifact");
      expect(rejection).toMatchObject({ code: "DISCOVERY_PROJECTION_PATH_UNSAFE" });
    } finally {
      await removeRedirect(artifactPath);
    }
  });
});
