import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";

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

const manifestSchema = z.object({
  schemaVersion: z.number().int().positive(),
  repository: z.object({
    name: z.string().min(1),
    path: z.string().min(1),
    packageVersion: z.string().optional(),
    commitSha: z.string().optional(),
  }),
  engine: z.object({
    packageVersion: z.string(),
    commitSha: z.string(),
    bunVersion: z.string(),
  }),
  analysis: z.object({
    projectId: z.string(),
    analysisRunId: z.string().optional(),
    generatedAt: z.string(),
  }),
  requiredArtifacts: z.array(z.string()),
  artifacts: z.record(
    z.string(),
    z.object({
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      bytes: z.number().nonnegative(),
    }),
  ),
});

export type DiscoveryManifest = z.infer<typeof manifestSchema>;

export type DiscoveryValidationStatus =
  | "VALID"
  | "MANIFEST_MISSING"
  | "MANIFEST_INVALID"
  | "PATH_MISMATCH"
  | "SCHEMA_MISMATCH"
  | "ARTIFACT_MISSING"
  | "CHECKSUM_MISMATCH";

export interface DiscoveryValidationResult {
  readonly valid: boolean;
  readonly status: DiscoveryValidationStatus;
  readonly reason?: string;
  readonly manifest?: DiscoveryManifest;
  readonly failedArtifact?: string;
}

export interface ValidateDiscoveryOptions {
  readonly projectPath: string;
  readonly discoveryDirectory?: string;
  readonly expectedSchemaVersion?: number;
  readonly verifyChecksums?: boolean;
}

export class DiscoveryValidator {
  public async validate(options: ValidateDiscoveryOptions): Promise<DiscoveryValidationResult> {
    const projectPath = resolve(options.projectPath);
    const discoveryDir = options.discoveryDirectory ? resolve(options.discoveryDirectory) : join(projectPath, ".discovery");
    const manifestPath = join(discoveryDir, "manifest.json");

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

    const parseResult = manifestSchema.safeParse(parsedJson);
    if (!parseResult.success) {
      return {
        valid: false,
        status: "MANIFEST_INVALID",
        reason: "Discovery manifest does not match required schema.",
      };
    }

    const manifest = parseResult.data;

    const expectedSchema = options.expectedSchemaVersion ?? 1;
    if (manifest.schemaVersion !== expectedSchema) {
      return {
        valid: false,
        status: "SCHEMA_MISMATCH",
        reason: `Manifest schema version ${manifest.schemaVersion} does not match expected ${expectedSchema}.`,
        manifest,
      };
    }

    if (resolve(manifest.repository.path) !== projectPath) {
      return {
        valid: false,
        status: "PATH_MISMATCH",
        reason: `Manifest repository path '${manifest.repository.path}' does not match target path '${projectPath}'.`,
        manifest,
      };
    }

    const verifyChecksums = options.verifyChecksums ?? true;

    let canonicalDiscoveryDir = discoveryDir;
    try {
      canonicalDiscoveryDir = await realpath(discoveryDir);
    } catch {}

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
    }

    return {
      valid: true,
      status: "VALID",
      manifest,
    };
  }
}
