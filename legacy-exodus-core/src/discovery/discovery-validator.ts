import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";

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

    for (const artifactName of manifest.requiredArtifacts) {
      const artifactPath = join(discoveryDir, artifactName);
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
        content = await readFile(artifactPath);
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
