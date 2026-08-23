import { z } from "zod";

import { LegacyExodusError } from "@shared/errors";

export type DiscoveryArtifactName =
  | "project.json"
  | "files.json"
  | "dependencies.json"
  | "frameworks.json"
  | "summary.json"
  | "enumeration-failures.json"
  | "dependency-graph.json"
  | "modules.json"
  | "symbols.json"
  | "knowledge.json"
  | "semantic.json"
  | "cfg.json"
  | "control-flow.json"
  | "data-flow.json";

export interface DiscoveryArtifact {
  readonly name: DiscoveryArtifactName;
  readonly payload: unknown;
}

export interface DiscoveryProjection {
  readonly projectPath: string;
  readonly artifacts: readonly DiscoveryArtifact[];
}

const artifactNames: readonly DiscoveryArtifactName[] = [
  "project.json",
  "files.json",
  "dependencies.json",
  "frameworks.json",
  "summary.json",
  "enumeration-failures.json",
  "dependency-graph.json",
  "modules.json",
  "symbols.json",
  "knowledge.json",
  "semantic.json",
  "cfg.json",
  "control-flow.json",
  "data-flow.json",
];

const discoveryProjectionSchema = z.object({
  projectPath: z.string().min(1),
  artifacts: z.array(
    z.object({
      name: z.enum(artifactNames),
      payload: z.unknown(),
    }),
  ),
});

export function createDiscoveryProjection(projection: DiscoveryProjection): DiscoveryProjection {
  const parsedProjection = discoveryProjectionSchema.safeParse(projection);

  if (!parsedProjection.success) {
    throw new LegacyExodusError({
      code: "DISCOVERY_PROJECTION_INVALID",
      message: "Discovery projection is invalid.",
      metadata: { issues: parsedProjection.error.issues },
    });
  }

  return Object.freeze({
    projectPath: parsedProjection.data.projectPath,
    artifacts: Object.freeze(
      parsedProjection.data.artifacts.map((artifact) =>
        Object.freeze({ name: artifact.name, payload: deepFreeze(artifact.payload) }),
      ),
    ),
  });
}

function deepFreeze(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Object.isFrozen(value)) {
    return value;
  }

  for (const nestedValue of Object.values(value)) {
    deepFreeze(nestedValue);
  }

  return Object.freeze(value);
}
