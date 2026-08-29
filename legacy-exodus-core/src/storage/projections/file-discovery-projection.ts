import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import type { DiscoveryProjection } from "@contracts/discovery-projection";
import { StreamingJsonWriter } from "./streaming-json-writer";

export class FileDiscoveryProjectionAdapter {
  private readonly writer = new StreamingJsonWriter();
  private readonly directoryQueues = new Map<string, Promise<void>>();

  public async write(projection: DiscoveryProjection): Promise<void> {
    const discoveryDirectory = join(resolve(projection.projectPath), ".discovery");

    const previous = this.directoryQueues.get(discoveryDirectory) ?? Promise.resolve();

    const currentTask = (async () => {
      await previous.catch(() => {});
      await this.writeArtifacts(discoveryDirectory, projection);
    })();

    this.directoryQueues.set(discoveryDirectory, currentTask);

    try {
      await currentTask;
    } finally {
      if (this.directoryQueues.get(discoveryDirectory) === currentTask) {
        this.directoryQueues.delete(discoveryDirectory);
      }
    }
  }

  public async drain(): Promise<void> {
    const active = [...this.directoryQueues.values()];
    if (active.length > 0) {
      await Promise.allSettled(active);
    }
  }

  private async writeArtifacts(discoveryDirectory: string, projection: DiscoveryProjection): Promise<void> {
    await mkdir(discoveryDirectory, { recursive: true });

    const artifactHashes: Record<string, { sha256: string; bytes: number }> = {};

    for (const artifact of projection.artifacts) {
      if (artifact.name === "manifest.json") continue;
      const destination = join(discoveryDirectory, artifact.name);
      await this.writer.writeAtomic(destination, artifact.payload);

      const content = await readFile(destination);
      const sha256 = createHash("sha256").update(content).digest("hex");
      artifactHashes[artifact.name] = { sha256, bytes: content.length };
    }

    // Resolve repository metadata
    let pkgVersion: string | undefined;
    let pkgName: string | undefined;
    try {
      const pkgJson = JSON.parse(await readFile(join(projection.projectPath, "package.json"), "utf8"));
      pkgVersion = pkgJson.version;
      pkgName = pkgJson.name;
    } catch {}

    let repoCommitSha: string | undefined;
    try {
      repoCommitSha = execSync("git rev-parse HEAD", {
        cwd: projection.projectPath,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {}

    // Resolve engine metadata
    let engineCommitSha = "uncommitted/local";
    try {
      engineCommitSha = execSync("git rev-parse HEAD", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {}

    let enginePackageVersion = "0.1.0";
    try {
      const enginePkg = JSON.parse(await readFile(resolve(import.meta.dir, "../../..", "package.json"), "utf8"));
      enginePackageVersion = enginePkg.version ?? "0.1.0";
    } catch {}

    const bunVer = typeof process.versions.bun === "string" ? process.versions.bun : process.version;

    const manifest = {
      schemaVersion: 1,
      repository: {
        name: projection.metadata?.projectName ?? pkgName ?? basename(projection.projectPath),
        path: projection.projectPath,
        ...(pkgVersion ? { packageVersion: pkgVersion } : {}),
        ...(repoCommitSha ? { commitSha: repoCommitSha } : {}),
      },
      engine: {
        packageVersion: enginePackageVersion,
        commitSha: engineCommitSha,
        bunVersion: `bun-${bunVer}`,
      },
      analysis: {
        projectId: projection.metadata?.projectId ?? "00000000-0000-4000-8000-000000000000",
        ...(projection.metadata?.analysisRunId ? { analysisRunId: projection.metadata.analysisRunId } : {}),
        generatedAt: new Date().toISOString(),
      },
      requiredArtifacts: Object.keys(artifactHashes).sort(),
      artifacts: artifactHashes,
    };

    await this.writer.writeAtomic(join(discoveryDirectory, "manifest.json"), manifest);
  }
}
