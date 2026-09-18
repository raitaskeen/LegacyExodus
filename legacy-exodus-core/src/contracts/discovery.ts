import { z } from "zod";

import { LegacyExodusError } from "@shared/errors";

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

export interface FileScanResult {
  readonly files: readonly FileArtifact[];
  readonly enumerationFailures: readonly DiscoveryEnumerationFailure[];
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

const dependencyArtifactSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  kind: z.enum(["production", "development"]),
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

  return Object.freeze({
    ...parsedDiscovery.data,
    files: Object.freeze(parsedDiscovery.data.files.map((file) => Object.freeze({ ...file }))),
    dependencies: Object.freeze(
      parsedDiscovery.data.dependencies.map((dependency) => Object.freeze({ ...dependency })),
    ),
    frameworks: Object.freeze(
      parsedDiscovery.data.frameworks.map((framework) => Object.freeze({ ...framework })),
    ),
    languages: Object.freeze([...parsedDiscovery.data.languages]),
    enumerationFailures: Object.freeze(
      (parsedDiscovery.data.enumerationFailures ?? []).map((failure) => Object.freeze({ ...failure })),
    ),
    manifestFailures: Object.freeze(
      (parsedDiscovery.data.manifestFailures ?? []).map((failure) => Object.freeze({ ...failure })),
    ),
  });
}
