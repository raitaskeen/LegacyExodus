import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "bun:test";

import { createDiscoveryProjection } from "@contracts/discovery-projection";
import { FileDiscoveryProjectionAdapter, resolveGitCommitSha } from "@storage/index";

const engineRoot = resolve(import.meta.dir, "../../..");
const projectionRunner = resolve(import.meta.dir, "../../fixtures/projection-cwd-runner.ts");

describe("JEV-A09 engine provenance isolation", () => {
  it("does not derive engine provenance from the ambient target-repository CWD", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "legacy-exodus provenance "));
    const targetRepository = join(temporaryRoot, "target repository");
    const unrelatedDirectory = join(temporaryRoot, "unrelated non-git directory");
    const unrelatedRepository = join(temporaryRoot, "unrelated git repository");
    await mkdir(targetRepository);
    await mkdir(unrelatedDirectory);
    await mkdir(unrelatedRepository);
    await initializeRepository(targetRepository, "target");
    await initializeRepository(unrelatedRepository, "unrelated");

    const targetSha = resolveGitCommitSha(targetRepository);
    const engineSha = resolveGitCommitSha(engineRoot);
    if (targetSha === undefined || engineSha === undefined) {
      throw new Error("Expected both regression repositories to expose Git provenance.");
    }
    expect(targetSha).toMatch(/^[0-9a-f]{40}$/);
    expect(engineSha).toMatch(/^[0-9a-f]{40}$/);
    expect(targetSha).not.toBe(engineSha);

    runProjection(targetRepository, targetRepository);

    try {
      const manifest = JSON.parse(
        await readFile(join(targetRepository, ".discovery", "manifest.json"), "utf8"),
      ) as {
        readonly repository: { readonly commitSha?: string };
        readonly engine: { readonly commitSha: string };
      };

      expect(manifest.repository.commitSha).toBe(targetSha);
      expect(manifest.engine.commitSha).toBe(engineSha);
      expect(manifest.engine.commitSha).not.toBe(targetSha);

      runProjection(unrelatedDirectory, targetRepository);
      const repeatedManifest = JSON.parse(
        await readFile(join(targetRepository, ".discovery", "manifest.json"), "utf8"),
      ) as { readonly engine: { readonly commitSha: string } };
      expect(repeatedManifest.engine.commitSha).toBe(engineSha);

      runProjection(unrelatedRepository, targetRepository);
      const thirdManifest = JSON.parse(
        await readFile(join(targetRepository, ".discovery", "manifest.json"), "utf8"),
      ) as { readonly engine: { readonly commitSha: string } };
      expect(thirdManifest.engine.commitSha).toBe(engineSha);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("uses the explicit deterministic fallback when engine Git metadata is unavailable", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "legacy-exodus no provenance "));
    const engineWithoutGit = join(temporaryRoot, "packaged engine");
    const projectPath = join(temporaryRoot, "target project");
    await mkdir(engineWithoutGit);
    await mkdir(projectPath);

    try {
      const adapter = new FileDiscoveryProjectionAdapter(engineWithoutGit);
      await adapter.write(createProjection(projectPath));
      const firstManifest = JSON.parse(
        await readFile(join(projectPath, ".discovery", "manifest.json"), "utf8"),
      ) as { readonly engine: { readonly commitSha: string } };

      await adapter.write(createProjection(projectPath));
      const secondManifest = JSON.parse(
        await readFile(join(projectPath, ".discovery", "manifest.json"), "utf8"),
      ) as { readonly engine: { readonly commitSha: string } };

      expect(firstManifest.engine.commitSha).toBe("uncommitted/local");
      expect(secondManifest.engine.commitSha).toBe("uncommitted/local");
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});

async function initializeRepository(repositoryPath: string, content: string): Promise<void> {
  runGit(repositoryPath, ["init"]);
  runGit(repositoryPath, ["config", "user.email", "jev-a09@legacyexodus.local"]);
  runGit(repositoryPath, ["config", "user.name", "JEV-A09 Regression"]);
  await writeFile(join(repositoryPath, "fixture.txt"), `${content}-${randomUUID()}\n`, "utf8");
  runGit(repositoryPath, ["add", "fixture.txt"]);
  runGit(repositoryPath, ["commit", "-m", "fixture"]);
}

function runGit(cwd: string, args: readonly string[]): void {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`Git fixture command failed: ${result.stderr}`);
  }
}

function runProjection(cwd: string, projectPath: string): void {
  const result = spawnSync(process.execPath, [projectionRunner, projectPath], {
    cwd,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`Projection fixture failed: ${result.stderr}`);
  }
}

function createProjection(projectPath: string) {
  return createDiscoveryProjection({
    projectPath,
    artifacts: [{ name: "summary.json", payload: { fileCount: 0 } }],
  });
}
