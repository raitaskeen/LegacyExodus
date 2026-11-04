import { z } from "zod";

import { LegacyExodusError } from "@shared/errors";
import { immutable } from "@shared/immutability";

export interface FileArtifact {
  readonly id: string;
  readonly path: string;
  readonly language: string;
  /** Present for scanner output; optional while historical persisted artifacts are upgraded. */
  readonly fileKind?: FileKind;
  readonly size: number;
}

export type FileKind =
  | "source"
  | "configuration"
  | "manifest"
  | "documentation"
  | "markup"
  | "stylesheet"
  | "data"
  | "database-schema"
  | "ci-cd"
  | "container"
  | "build"
  | "generated"
  | "binary"
  | "unknown";

export interface DependencyArtifact {
  readonly name: string;
  readonly version: string;
  readonly kind: "production" | "development";
  /** The workspace package.json that declares it; absent for the root manifest. */
  readonly manifest?: string;
}

export interface FrameworkArtifact {
  readonly name: string;
  readonly evidence: string;
}

export interface DiscoveryEnumerationFailure {
  readonly path: string;
  readonly kind: "directory-read" | "entry-stat";
  readonly code: string;
}

export interface DiscoveryManifestFailure {
  readonly path: "package.json";
  readonly kind: "manifest-read" | "manifest-parse" | "manifest-validation";
  readonly code: string;
}

/** A path left out on purpose because an ignore rule says it is not the project's source (BA-15). */
export interface ExcludedPath {
  readonly path: string;
  readonly kind: "directory" | "file";
  readonly reason: "gitignore" | "legacyexodusignore";
}

export interface FileScanResult {
  readonly files: readonly FileArtifact[];
  readonly enumerationFailures: readonly DiscoveryEnumerationFailure[];
  readonly excludedPaths?: readonly ExcludedPath[];
}

export interface ProjectDiscovery {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectPath: string;
  readonly files: readonly FileArtifact[];
  readonly dependencies: readonly DependencyArtifact[];
  readonly frameworks: readonly FrameworkArtifact[];
  readonly languages: readonly string[];
  readonly enumerationFailures: readonly DiscoveryEnumerationFailure[];
  readonly manifestFailures: readonly DiscoveryManifestFailure[];
  /** Paths ignore rules leave out of analysis; listed so nothing disappears silently. */
  readonly excludedPaths: readonly ExcludedPath[];
  readonly discoveredAt: Date;
}

const fileArtifactSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  language: z.string().min(1),
  fileKind: z.enum(["source", "configuration", "manifest", "documentation", "markup", "stylesheet", "data", "database-schema", "ci-cd", "container", "build", "generated", "binary", "unknown"]).optional(),
  size: z.number().nonnegative(),
});

const discoveryEnumerationFailureSchema = z.object({
  path: z.string().min(1),
  kind: z.enum(["directory-read", "entry-stat"]),
  code: z.string().min(1),
});

const discoveryManifestFailureSchema = z.object({
  path: z.literal("package.json"),
  kind: z.enum(["manifest-read", "manifest-parse", "manifest-validation"]),
  code: z.string().min(1),
});

export const excludedPathSchema = z.object({
  path: z.string().min(1),
  kind: z.enum(["directory", "file"]),
  reason: z.enum(["gitignore", "legacyexodusignore"]),
}).strict();

const dependencyArtifactSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  kind: z.enum(["production", "development"]),
  manifest: z.string().min(1).optional(),
});

const frameworkArtifactSchema = z.object({
  name: z.string().min(1),
  evidence: z.string().min(1),
});

const projectDiscoverySchema = z.object({
  projectId: z.string().uuid(),
  projectName: z.string().min(1),
  projectPath: z.string().min(1),
  files: z.array(fileArtifactSchema),
  dependencies: z.array(dependencyArtifactSchema),
  frameworks: z.array(frameworkArtifactSchema),
  languages: z.array(z.string().min(1)),
  enumerationFailures: z.array(discoveryEnumerationFailureSchema).optional(),
  manifestFailures: z.array(discoveryManifestFailureSchema).optional(),
  excludedPaths: z.array(excludedPathSchema).optional(),
  discoveredAt: z.date(),
});

export function validateProjectDiscovery(discovery: unknown): ProjectDiscovery {
  const parsedDiscovery = projectDiscoverySchema.safeParse(discovery);

  if (!parsedDiscovery.success) {
    throw new LegacyExodusError({
      code: "PROJECT_DISCOVERY_INVALID",
      message: "Project discovery result is invalid.",
      metadata: { issues: parsedDiscovery.error.issues },
    });
  }

  return immutable({
    ...parsedDiscovery.data,
    files: immutable(parsedDiscovery.data.files.map((file) => immutable({ ...file }))),
    dependencies: immutable(
      parsedDiscovery.data.dependencies.map((dependency) => immutable({ ...dependency })),
    ),
    frameworks: immutable(
      parsedDiscovery.data.frameworks.map((framework) => immutable({ ...framework })),
    ),
    languages: immutable([...parsedDiscovery.data.languages]),
    enumerationFailures: immutable(
      (parsedDiscovery.data.enumerationFailures ?? []).map((failure) => immutable({ ...failure })),
    ),
    manifestFailures: immutable(
      (parsedDiscovery.data.manifestFailures ?? []).map((failure) => immutable({ ...failure })),
    ),
    excludedPaths: immutable(
      (parsedDiscovery.data.excludedPaths ?? []).map((excluded) => immutable({ ...excluded })),
    ),
  });
}
