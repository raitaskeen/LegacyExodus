import { spawnSync } from "node:child_process";
import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { createDiscoveryProjection, type DiscoveryProjection } from "@contracts/discovery-projection";
import {
  computeManifestMac,
  computeWorkspaceDigest,
  createSnapshotTrust,
  manifestKeyId,
  MANIFEST_MAC_ALGORITHM,
  type DiscoveryManifest,
  type SnapshotTrust,
} from "@discovery/index";
import { LegacyExodusError } from "@shared/errors";
import { StreamingJsonWriter } from "./streaming-json-writer";

const unsafeProjectionPathCode = "DISCOVERY_PROJECTION_PATH_UNSAFE";
const defaultEngineRoot = resolve(import.meta.dir, "../../..");

function isFileSystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isPhysicallyContained(parentPath: string, candidatePath: string): boolean {
  const relation = relative(parentPath, candidatePath);
  return relation.length > 0
    && relation !== ".."
    && !relation.startsWith(`..${sep}`)
    && !isAbsolute(relation);
}

/** Physical path of `path`, resolving the nearest existing ancestor when it does not exist yet. */
async function physicalPath(path: string): Promise<string> {
  const absolute = resolve(path);
  const missingSegments: string[] = [];
  for (let current = absolute; ; current = dirname(current)) {
    try {
      return join(await realpath(current), ...missingSegments);
    } catch {}
    if (dirname(current) === current) return absolute;
    missingSegments.unshift(basename(current));
  }
}

function unsafeProjectionPath(path: string, reason: string, cause?: unknown): LegacyExodusError {
  return new LegacyExodusError({
    code: unsafeProjectionPathCode,
    message: "Discovery projection output path is unsafe.",
    metadata: { path, reason },
    ...(cause === undefined ? {} : { cause }),
  });
}

/**
 * Resolves the git commit SHA of the given directory.
 *
 * Security boundary: invokes `git` directly using `spawnSync` with `shell: false`
 * and strictly isolated stdio to eliminate shell injection risks (SEC-01).
 *
 * @param cwd - Explicit working directory path.
 * @returns 40-character git commit SHA string, or `undefined` if not a git repository or git fails.
 */
export function resolveGitCommitSha(cwd: string): string | undefined {
  try {
    const result = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      shell: false,
    });

    if (result.status === 0 && typeof result.stdout === "string") {
      const trimmed = result.stdout.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }
  } catch {}

  return undefined;
}

export class FileDiscoveryProjectionAdapter {
  private readonly writer = new StreamingJsonWriter();
  private readonly directoryQueues = new Map<string, Promise<void>>();

  public constructor(
    private readonly engineRoot: string = defaultEngineRoot,
    private readonly trust: SnapshotTrust = createSnapshotTrust(),
  ) {}

  /**
   * Serializes a discovery projection into atomic JSON artifacts on disk.
   *
   * Coordinates directory writes through an internal Promise queue to prevent concurrent
   * write interleaving and file corruption when projections for the same directory overlap.
   */
  public async write(projection: DiscoveryProjection): Promise<void> {
    const validatedProjection = createDiscoveryProjection(projection);
    const discoveryDirectory = join(resolve(validatedProjection.projectPath), ".discovery");

    const previous = this.directoryQueues.get(discoveryDirectory) ?? Promise.resolve();

    const currentTask = (async () => {
      await previous.catch(() => {});
      await this.writeArtifacts(discoveryDirectory, validatedProjection);
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

  /**
   * Flushes and awaits all in-flight filesystem projection writes before service shutdown.
   */
  public async drain(): Promise<void> {
    const active = [...this.directoryQueues.values()];
    if (active.length > 0) {
      await Promise.allSettled(active);
    }
  }

  private async writeArtifacts(discoveryDirectory: string, projection: DiscoveryProjection): Promise<void> {
    await this.ensureSafeDiscoveryDirectory(projection.projectPath, discoveryDirectory);

    const artifactDestinations = projection.artifacts
      .filter((artifact) => artifact.name !== "manifest.json")
      .map((artifact) => join(discoveryDirectory, artifact.name));
    artifactDestinations.push(join(discoveryDirectory, "manifest.json"));

    for (const destination of artifactDestinations) {
      await this.ensureSafeArtifactDestination(projection.projectPath, discoveryDirectory, destination);
    }

    const artifactHashes: Record<string, { sha256: string; bytes: number }> = {};

    for (const artifact of projection.artifacts) {
      if (artifact.name === "manifest.json") continue;
      const destination = join(discoveryDirectory, artifact.name);
      await this.ensureSafeArtifactDestination(projection.projectPath, discoveryDirectory, destination);
      const { sha256, bytes } = await this.writer.writeAtomic(destination, artifact.payload);
      await this.ensureSafeArtifactDestination(projection.projectPath, discoveryDirectory, destination);
      artifactHashes[artifact.name] = { sha256, bytes };
    }

    // Resolve repository metadata
    let pkgVersion: string | undefined;
    let pkgName: string | undefined;
    try {
      const pkgJson = JSON.parse(await readFile(join(projection.projectPath, "package.json"), "utf8"));
      pkgVersion = pkgJson.version;
      pkgName = pkgJson.name;
    } catch {}

    const repoCommitSha = resolveGitCommitSha(projection.projectPath);

    // Resolve engine metadata
    const engineCommitSha = resolveGitCommitSha(this.engineRoot) ?? "uncommitted/local";

    let enginePackageVersion = "0.1.0";
    try {
      const enginePkg = JSON.parse(await readFile(join(this.engineRoot, "package.json"), "utf8"));
      enginePackageVersion = enginePkg.version ?? "0.1.0";
    } catch {}

    const bunVer = typeof process.versions.bun === "string" ? process.versions.bun : process.version;

    // Compute source digest for workspace freshness
    const filesArtifact = projection.artifacts.find((a) => a.name === "files.json");
    const files = Array.isArray(filesArtifact?.payload)
      ? (filesArtifact?.payload as readonly { readonly path: string }[])
      : undefined;
    const sourceDigest = await computeWorkspaceDigest(projection.projectPath, files);
    // Reuse is bound to the physical location, never to a cwd-relative spelling.
    const canonicalProjectPath = await realpath(resolve(projection.projectPath));
    // The output belongs to the analyzer this process loaded. If its source has changed since,
    // the identity of the code that ran can no longer be stated, so none is recorded.
    const loadedFingerprint = await this.trust.analyzerFingerprint();
    const analyzerFingerprint = loadedFingerprint !== undefined && loadedFingerprint === await this.trust.currentAnalyzerFingerprint()
      ? loadedFingerprint
      : undefined;

    const unsignedManifest: DiscoveryManifest = {
      schemaVersion: 1,
      repository: {
        name: projection.metadata?.projectName ?? pkgName ?? basename(projection.projectPath),
        path: canonicalProjectPath,
        ...(pkgVersion ? { packageVersion: pkgVersion } : {}),
        ...(repoCommitSha ? { commitSha: repoCommitSha } : {}),
        sourceDigest,
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
      ...(analyzerFingerprint === undefined ? {} : { analyzer: { fingerprint: analyzerFingerprint } }),
    };
    const manifest = await this.authenticate(unsignedManifest, canonicalProjectPath);

    const manifestPath = join(discoveryDirectory, "manifest.json");
    await this.ensureSafeArtifactDestination(projection.projectPath, discoveryDirectory, manifestPath);
    await this.writer.writeAtomic(manifestPath, manifest);
    await this.ensureSafeArtifactDestination(projection.projectPath, discoveryDirectory, manifestPath);
  }

  /**
   * Signs the manifest with the local snapshot key. Without a usable key outside the
   * project the manifest stays unsigned: analysis output is still published, but the
   * snapshot can never be authorized for reuse.
   */
  private async authenticate(manifest: DiscoveryManifest, canonicalProjectPath: string): Promise<DiscoveryManifest> {
    const keyStore = this.trust.keyStore;
    const keyDirectory = await physicalPath(keyStore.directory);
    if (keyDirectory === canonicalProjectPath || isPhysicallyContained(canonicalProjectPath, keyDirectory)) {
      return manifest;
    }

    try {
      const key = await keyStore.getOrCreateKey();
      // Signing also fails for manifests outside the contract (e.g. a non-string repository
      // version); such snapshots stay unsigned and unreusable, as they were never reusable before.
      return {
        ...manifest,
        integrity: { algorithm: MANIFEST_MAC_ALGORITHM, keyId: manifestKeyId(key), mac: computeManifestMac(manifest, key) },
      };
    } catch {
      return manifest;
    }
  }

  private async ensureSafeDiscoveryDirectory(projectPath: string, discoveryDirectory: string): Promise<string> {
    let canonicalProjectPath: string;
    try {
      canonicalProjectPath = await realpath(resolve(projectPath));
    } catch (error: unknown) {
      throw unsafeProjectionPath(projectPath, "Project directory cannot be resolved physically.", error);
    }

    let discoveryStats;
    try {
      discoveryStats = await lstat(discoveryDirectory);
    } catch (error: unknown) {
      if (!isFileSystemError(error) || error.code !== "ENOENT") {
        throw unsafeProjectionPath(discoveryDirectory, "Discovery directory cannot be inspected.", error);
      }

      try {
        await mkdir(discoveryDirectory);
      } catch (mkdirError: unknown) {
        if (!isFileSystemError(mkdirError) || mkdirError.code !== "EEXIST") {
          throw unsafeProjectionPath(discoveryDirectory, "Discovery directory cannot be created safely.", mkdirError);
        }
      }

      try {
        discoveryStats = await lstat(discoveryDirectory);
      } catch (inspectionError: unknown) {
        throw unsafeProjectionPath(discoveryDirectory, "Created discovery directory cannot be inspected.", inspectionError);
      }
    }

    if (discoveryStats.isSymbolicLink() || !discoveryStats.isDirectory()) {
      throw unsafeProjectionPath(discoveryDirectory, "Discovery output must be an ordinary directory.");
    }

    let canonicalDiscoveryDirectory: string;
    try {
      canonicalDiscoveryDirectory = await realpath(discoveryDirectory);
    } catch (error: unknown) {
      throw unsafeProjectionPath(discoveryDirectory, "Discovery directory cannot be resolved physically.", error);
    }

    if (!isPhysicallyContained(canonicalProjectPath, canonicalDiscoveryDirectory)) {
      throw unsafeProjectionPath(discoveryDirectory, "Discovery directory resolves outside the project boundary.");
    }

    return canonicalDiscoveryDirectory;
  }

  private async ensureSafeArtifactDestination(
    projectPath: string,
    discoveryDirectory: string,
    destination: string,
  ): Promise<void> {
    const canonicalDiscoveryDirectory = await this.ensureSafeDiscoveryDirectory(projectPath, discoveryDirectory);

    let destinationStats;
    try {
      destinationStats = await lstat(destination);
    } catch (error: unknown) {
      if (isFileSystemError(error) && error.code === "ENOENT") {
        return;
      }
      throw unsafeProjectionPath(destination, "Artifact destination cannot be inspected.", error);
    }

    if (destinationStats.isSymbolicLink() || !destinationStats.isFile() || destinationStats.nlink !== 1) {
      throw unsafeProjectionPath(
        destination,
        "Artifact destination must be absent or an ordinary single-link file.",
      );
    }

    let canonicalDestination: string;
    try {
      canonicalDestination = await realpath(destination);
    } catch (error: unknown) {
      throw unsafeProjectionPath(destination, "Artifact destination cannot be resolved physically.", error);
    }

    if (!isPhysicallyContained(canonicalDiscoveryDirectory, canonicalDestination)) {
      throw unsafeProjectionPath(destination, "Artifact destination resolves outside the discovery directory.");
    }
  }
}
