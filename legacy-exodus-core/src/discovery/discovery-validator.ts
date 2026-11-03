import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";

import type { FileArtifact } from "@contracts/discovery";
import { discoveryManifestSchema, MANIFEST_SCHEMA_VERSION, manifestKeyId, manifestLocationDigest, verifyManifestMac, type DiscoveryManifest } from "./discovery-manifest";
import { FileScanner } from "./file-scanner";
import { createSnapshotTrust, type SnapshotTrust } from "./snapshot-trust";
import { compareCodePoints } from "@shared/ordering";

export type { DiscoveryManifest };

export function isPathWithinDirectory(parentDir: string, candidatePath: string): boolean {
  if (typeof candidatePath !== "string" || candidatePath.trim().length === 0) {
    return false;
  }

  const trimmed = candidatePath.trim();

  // Reject absolute paths
  if (isAbsolute(trimmed)) {
    return false;
  }

  // Reject Windows drive-relative or absolute drive prefixes (e.g. "C:foo", "c:\foo")
  if (/^[a-zA-Z]:/.test(trimmed)) {
    return false;
  }

  // Reject Windows UNC paths (e.g. "\\server\share")
  if (trimmed.startsWith("\\\\") || trimmed.startsWith("//")) {
    return false;
  }

  // Reject null bytes
  if (trimmed.includes("\0")) {
    return false;
  }

  const canonicalParent = resolve(parentDir);
  const resolvedCandidate = resolve(canonicalParent, trimmed);

  // Canonical relative calculation
  const rel = relative(canonicalParent, resolvedCandidate);

  // If relative path starts with ".." or is absolute, it escapes parentDir
  if (rel.startsWith("..") || isAbsolute(rel) || rel === "") {
    return false;
  }

  return true;
}

const freshnessFilesSchema = z.array(z.object({
  path: z.string().min(1),
  size: z.number().nonnegative(),
}));

export type DiscoveryValidationStatus =
  | "VALID"
  | "MANIFEST_MISSING"
  | "MANIFEST_INVALID"
  | "PATH_MISMATCH"
  | "SCHEMA_MISMATCH"
  | "ARTIFACT_MISSING"
  | "CHECKSUM_MISMATCH"
  | "SNAPSHOT_STALE"
  | "UNAUTHENTICATED"
  | "ANALYZER_MISMATCH";

export interface DiscoveryValidationResult {
  readonly valid: boolean;
  readonly status: DiscoveryValidationStatus;
  readonly reason?: string;
  readonly manifest?: DiscoveryManifest;
  readonly failedArtifact?: string;
  readonly validatedArtifacts?: ReadonlyMap<string, string>;
}

export interface ValidateDiscoveryOptions {
  readonly projectPath: string;
  readonly discoveryDirectory?: string;
  readonly expectedSchemaVersion?: number;
  readonly verifyChecksums?: boolean;
  readonly verifyFreshness?: boolean;
  /**
   * Additionally require that the snapshot may be reused as current analysis:
   * its manifest is bound to this canonical project location, is authenticated
   * by the local snapshot key, and names the running analyzer build.
   */
  readonly authorizeReuse?: boolean;
}

/**
 * Computes a deterministic SHA-256 digest of workspace source files.
 *
 * Sorts all files lexicographically by path and hashes each file's content
 * to produce a single stable signature of repository state for freshness verification.
 *
 * @param projectPath - Absolute path to the workspace root directory.
 * @param files - Optional precomputed file list; if omitted, scans workspace automatically.
 * @returns Deterministic SHA-256 hex digest of the workspace source content.
 */
export async function computeWorkspaceDigest(
  projectPath: string,
  files?: readonly { readonly path: string }[],
): Promise<string> {
  const resolvedProjectPath = resolve(projectPath);
  let fileList = files;
  if (fileList === undefined) {
    try {
      const scanner = new FileScanner();
      const scanResult = await scanner.scan(resolvedProjectPath);
      fileList = scanResult.files;
    } catch {
      fileList = [];
    }
  }

  const sortedFiles = [...fileList].sort((a, b) => compareCodePoints(a.path, b.path));
  const hasher = createHash("sha256");

  for (const file of sortedFiles) {
    const filePath = resolve(resolvedProjectPath, file.path);
    try {
      const content = await readFile(filePath);
      const fileHash = createHash("sha256").update(content).digest("hex");
      hasher.update(`${file.path}:${fileHash}\n`);
    } catch {
      hasher.update(`${file.path}:<unreadable>\n`);
    }
  }

  return hasher.digest("hex");
}

export class DiscoveryValidator {
  public constructor(private readonly trust: SnapshotTrust = createSnapshotTrust()) {}

  /**
   * Validates a `.discovery` snapshot directory and its associated manifest.
   *
   * Enforces strict containment and security boundaries:
   * - Rejects symlinked `.discovery` root directories and symlinked `manifest.json` (SEC-03).
   * - Validates that artifact paths do not escape the discovery directory via path traversal or symlinks (SEC-02).
   * - Verifies cryptographic SHA-256 hashes and byte lengths for all declared artifacts.
   * - Returns validated in-memory artifact bytes (`validatedArtifacts`) to eliminate TOCTOU risks (REUSE-03).
   * - Optionally performs workspace freshness check against current repository files and digest (REUSE-01).
   *
   * @param options - Validation configuration including project path and verification flags.
   * @returns Comprehensive validation outcome with status, manifest, and validated artifacts.
   */
  public async validate(options: ValidateDiscoveryOptions): Promise<DiscoveryValidationResult> {
    const projectPath = resolve(options.projectPath);
    const discoveryDir = options.discoveryDirectory ? resolve(options.discoveryDirectory) : join(projectPath, ".discovery");

    let discoveryStats;
    try {
      discoveryStats = await lstat(discoveryDir);
    } catch {
      return {
        valid: false,
        status: "MANIFEST_MISSING",
        reason: `Discovery directory not found at: ${discoveryDir}`,
      };
    }

    if (discoveryStats.isSymbolicLink()) {
      return {
        valid: false,
        status: "MANIFEST_INVALID",
        reason: `Discovery directory '${discoveryDir}' is a symbolic link, which is not permitted.`,
      };
    }

    if (!discoveryStats.isDirectory()) {
      return {
        valid: false,
        status: "MANIFEST_INVALID",
        reason: `Discovery directory '${discoveryDir}' is not a directory.`,
      };
    }

    let canonicalDiscoveryDir = discoveryDir;
    try {
      canonicalDiscoveryDir = await realpath(discoveryDir);
    } catch {}

    if (!options.discoveryDirectory) {
      try {
        const canonicalProjectDir = await realpath(projectPath);
        const physicalRel = relative(canonicalProjectDir, canonicalDiscoveryDir);
        if (physicalRel.startsWith("..") || isAbsolute(physicalRel) || physicalRel === "") {
          return {
            valid: false,
            status: "MANIFEST_INVALID",
            reason: `Discovery directory '${discoveryDir}' physically resolves outside project directory.`,
          };
        }
      } catch {}
    }

    const manifestPath = join(discoveryDir, "manifest.json");

    let manifestStats;
    try {
      manifestStats = await lstat(manifestPath);
    } catch {
      return {
        valid: false,
        status: "MANIFEST_MISSING",
        reason: `Discovery manifest not found at: ${manifestPath}`,
      };
    }

    if (manifestStats.isSymbolicLink()) {
      return {
        valid: false,
        status: "MANIFEST_INVALID",
        reason: `Discovery manifest at '${manifestPath}' is a symbolic link, which is not permitted.`,
      };
    }

    try {
      const canonicalManifestPath = await realpath(manifestPath);
      const physicalRel = relative(canonicalDiscoveryDir, canonicalManifestPath);
      if (physicalRel.startsWith("..") || isAbsolute(physicalRel) || physicalRel === "") {
        return {
          valid: false,
          status: "MANIFEST_INVALID",
          reason: `Discovery manifest at '${manifestPath}' physically resolves outside discovery directory.`,
        };
      }
    } catch {}

    let manifestContent: string;
    try {
      manifestContent = await readFile(manifestPath, "utf8");
    } catch {
      return {
        valid: false,
        status: "MANIFEST_MISSING",
        reason: `Discovery manifest not found at: ${manifestPath}`,
      };
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(manifestContent);
    } catch {
      return {
        valid: false,
        status: "MANIFEST_INVALID",
        reason: "Discovery manifest is not valid JSON.",
      };
    }

    const parseResult = discoveryManifestSchema.safeParse(parsedJson);
    if (!parseResult.success) {
      return {
        valid: false,
        status: "MANIFEST_INVALID",
        reason: "Discovery manifest does not match required schema.",
      };
    }

    const manifest = parseResult.data;

    const expectedSchema = options.expectedSchemaVersion ?? MANIFEST_SCHEMA_VERSION;
    if (manifest.schemaVersion !== expectedSchema) {
      return {
        valid: false,
        status: "SCHEMA_MISMATCH",
        reason: `Manifest schema version ${manifest.schemaVersion} does not match expected ${expectedSchema}.`,
        manifest,
      };
    }

    const canonicalProjectPath = await canonicalPath(projectPath);
    // Only the local key can confirm the location; without it (or without a digest) the snapshot
    // still validates as a snapshot, but it can never be authorized for reuse.
    if (await this.locationDiffers(manifest, canonicalProjectPath)) {
      return {
        valid: false,
        status: "PATH_MISMATCH",
        reason: `The manifest was written for a different project location than '${projectPath}'.`,
        manifest,
      };
    }

    if (options.authorizeReuse === true) {
      const denial = await this.authorizeReuse(manifest, canonicalProjectPath);
      if (denial !== undefined) {
        return { valid: false, ...denial, manifest };
      }
    }

    const verifyChecksums = options.verifyChecksums ?? true;

    const validatedArtifacts = new Map<string, string>();

    for (const artifactName of manifest.requiredArtifacts) {
      if (!isPathWithinDirectory(discoveryDir, artifactName)) {
        return {
          valid: false,
          status: "MANIFEST_INVALID",
          reason: `Artifact path '${artifactName}' attempts traversal outside discovery directory.`,
          manifest,
          failedArtifact: artifactName,
        };
      }

      const artifactPath = resolve(discoveryDir, artifactName);
      const artifactMeta = manifest.artifacts[artifactName];

      if (!artifactMeta) {
        return {
          valid: false,
          status: "ARTIFACT_MISSING",
          reason: `Required artifact '${artifactName}' is not listed in manifest artifact registry.`,
          manifest,
          failedArtifact: artifactName,
        };
      }

      let content: Buffer;
      try {
        const stats = await lstat(artifactPath);
        if (stats.isSymbolicLink()) {
          return {
            valid: false,
            status: "MANIFEST_INVALID",
            reason: `Artifact path '${artifactName}' is a symbolic link, which is not permitted.`,
            manifest,
            failedArtifact: artifactName,
          };
        }

        const canonicalArtifactPath = await realpath(artifactPath);
        const physicalRel = relative(canonicalDiscoveryDir, canonicalArtifactPath);
        if (physicalRel.startsWith("..") || isAbsolute(physicalRel) || physicalRel === "") {
          return {
            valid: false,
            status: "MANIFEST_INVALID",
            reason: `Artifact path '${artifactName}' physically resolves outside discovery directory.`,
            manifest,
            failedArtifact: artifactName,
          };
        }

        content = await readFile(canonicalArtifactPath);
      } catch {
        return {
          valid: false,
          status: "ARTIFACT_MISSING",
          reason: `Required artifact file '${artifactName}' does not exist on disk at ${artifactPath}.`,
          manifest,
          failedArtifact: artifactName,
        };
      }

      if (verifyChecksums) {
        const computedSha256 = createHash("sha256").update(content).digest("hex");
        if (computedSha256 !== artifactMeta.sha256) {
          return {
            valid: false,
            status: "CHECKSUM_MISMATCH",
            reason: `Artifact '${artifactName}' SHA256 mismatch (expected: ${artifactMeta.sha256}, computed: ${computedSha256}).`,
            manifest,
            failedArtifact: artifactName,
          };
        }
      }

      validatedArtifacts.set(artifactName, content.toString("utf8"));
    }

    if (options.verifyFreshness === true) {
      const freshness = await this.verifyWorkspaceFreshness(projectPath, manifest, validatedArtifacts);
      if (!freshness.fresh) {
        return {
          valid: false,
          status: "SNAPSHOT_STALE",
          reason: freshness.reason,
          manifest,
        };
      }
    }

    return {
      valid: true,
      status: "VALID",
      manifest,
      validatedArtifacts: Object.freeze(validatedArtifacts),
    };
  }

  /**
   * Decides whether an integrity-valid manifest may stand in for fresh analysis.
   * Order: the local key, the exact canonical location, local-key authenticity, then analyzer
   * identity, so no unauthenticated field is trusted to explain a rejection.
   */
  private async authorizeReuse(
    manifest: DiscoveryManifest,
    canonicalProjectPath: string,
  ): Promise<{ readonly status: DiscoveryValidationStatus; readonly reason: string } | undefined> {
    const keyStore = this.trust.keyStore;
    if (isWithin(canonicalProjectPath, await canonicalPath(keyStore.directory))) {
      return { status: "UNAUTHENTICATED", reason: "The snapshot key must not be stored inside the analyzed project." };
    }

    let key: Buffer | undefined;
    try {
      key = await keyStore.readKey();
    } catch {
      return { status: "UNAUTHENTICATED", reason: "The local snapshot key is unreadable or invalid." };
    }
    if (key === undefined) {
      return { status: "UNAUTHENTICATED", reason: "No local snapshot key exists to authenticate this snapshot." };
    }
    if (manifest.repository.locationDigest !== manifestLocationDigest(canonicalProjectPath, key)) {
      return { status: "PATH_MISMATCH", reason: `Reusable snapshots must be bound to the canonical project location '${canonicalProjectPath}'.` };
    }
    if (!verifyManifestMac(manifest, key)) {
      return { status: "UNAUTHENTICATED", reason: "The snapshot manifest is not authenticated by the local snapshot key." };
    }

    const fingerprint = await this.trust.analyzerFingerprint();
    if (fingerprint === undefined) {
      return { status: "ANALYZER_MISMATCH", reason: "The running analyzer identity is unavailable, so snapshots cannot be reused." };
    }
    if (manifest.analyzer?.fingerprint !== fingerprint) {
      return { status: "ANALYZER_MISMATCH", reason: "The snapshot was produced by a different analyzer build." };
    }

    return undefined;
  }

  /** True only when the local key proves the manifest's location digest names another location. */
  private async locationDiffers(manifest: DiscoveryManifest, canonicalProjectPath: string): Promise<boolean> {
    const digest = manifest.repository.locationDigest;
    const keyStore = this.trust.keyStore;
    // A key inside the project proves nothing; reuse authorization refuses it on its own terms.
    if (digest === undefined || isWithin(canonicalProjectPath, await canonicalPath(keyStore.directory))) return false;
    let key: Buffer | undefined;
    try {
      key = await keyStore.readKey();
    } catch {
      return false;
    }
    return key !== undefined && manifest.integrity?.keyId === manifestKeyId(key) && digest !== manifestLocationDigest(canonicalProjectPath, key);
  }

  /**
   * Validates a `.discovery` snapshot directory with mandatory workspace freshness verification.
   *
   * @param projectPath - Absolute path to the workspace root.
   * @param discoveryDirectory - Optional custom discovery directory path.
   * @returns Validation outcome including freshness status.
   */
  public async validateFreshness(
    projectPath: string,
    discoveryDirectory?: string,
  ): Promise<DiscoveryValidationResult> {
    return this.validate({ projectPath, discoveryDirectory, verifyFreshness: true });
  }

  /**
   * Internal routine comparing current workspace filesystem contents against snapshot files.json
   * and content digest (REUSE-01).
   */
  private async verifyWorkspaceFreshness(
    projectPath: string,
    manifest: DiscoveryManifest,
    validatedArtifacts: ReadonlyMap<string, string>,
  ): Promise<{ readonly fresh: boolean; readonly reason?: string }> {
    if (manifest.repository.sourceDigest === undefined) {
      return {
        fresh: false,
        reason: "Snapshot manifest is missing sourceDigest required for freshness verification.",
      };
    }

    const filesRaw = validatedArtifacts.get("files.json");
    if (filesRaw === undefined) {
      return {
        fresh: false,
        reason: "Validated snapshot files.json is missing for freshness verification.",
      };
    }

    let snapshotFiles: readonly { readonly path: string; readonly size: number }[];
    try {
      const parsedFiles: unknown = JSON.parse(filesRaw);
      snapshotFiles = freshnessFilesSchema.parse(parsedFiles);
    } catch {
      return {
        fresh: false,
        reason: "Snapshot files.json is invalid for freshness verification.",
      };
    }

    let currentFiles: readonly FileArtifact[];
    try {
      const scanner = new FileScanner();
      const scanResult = await scanner.scan(projectPath);
      currentFiles = scanResult.files;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        fresh: false,
        reason: `Failed to scan current workspace for freshness check: ${message}`,
      };
    }

    if (currentFiles.length !== snapshotFiles.length) {
      return {
        fresh: false,
        reason: `Workspace file count changed (current: ${currentFiles.length}, snapshot: ${snapshotFiles.length}).`,
      };
    }

    const snapshotMap = new Map<string, { readonly path: string; readonly size: number }>();
    for (const file of snapshotFiles) {
      snapshotMap.set(file.path, file);
    }

    for (const currentFile of currentFiles) {
      const snapshotFile = snapshotMap.get(currentFile.path);
      if (snapshotFile === undefined) {
        return {
          fresh: false,
          reason: `Workspace contains new file not present in snapshot: '${currentFile.path}'.`,
        };
      }
      if (snapshotFile.size !== currentFile.size) {
        return {
          fresh: false,
          reason: `Workspace file size changed: '${currentFile.path}' (current: ${currentFile.size}, snapshot: ${snapshotFile.size}).`,
        };
      }
    }

    const currentDigest = await computeWorkspaceDigest(projectPath, currentFiles);
    if (currentDigest !== manifest.repository.sourceDigest) {
      return {
        fresh: false,
        reason: `Workspace source content digest mismatch (current: ${currentDigest}, snapshot: ${manifest.repository.sourceDigest}).`,
      };
    }

    return { fresh: true };
  }
}

/** Physical absolute path when it exists, otherwise the lexical absolute path. */
async function canonicalPath(path: string): Promise<string> {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch {
    return absolute;
  }
}

function isWithin(parent: string, candidate: string): boolean {
  const relation = relative(parent, candidate);
  return relation === "" || (!isAbsolute(relation) && relation !== ".." && !relation.startsWith(`..${sep}`));
}
