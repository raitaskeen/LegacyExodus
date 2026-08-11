import { z } from "zod";

import { LegacyExodusError } from "@shared/errors";

export interface FileArtifact {
  readonly id: string;
  readonly path: string;
  readonly language: string;
  readonly size: number;
}

export interface DependencyArtifact {
  readonly name: string;
  readonly version: string;
  readonly kind: "production" | "development";
}

export interface FrameworkArtifact {
  readonly name: string;
  readonly evidence: string;
}

export interface ProjectDiscovery {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectPath: string;
  readonly files: readonly FileArtifact[];
  readonly dependencies: readonly DependencyArtifact[];
  readonly frameworks: readonly FrameworkArtifact[];
  readonly languages: readonly string[];
  readonly discoveredAt: Date;
}

const fileArtifactSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  language: z.string().min(1),
  size: z.number().nonnegative(),
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
  });
}
