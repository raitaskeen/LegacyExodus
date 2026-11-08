import type { Artifact } from "./entities";
import { immutable } from "@shared/immutability";

export enum ProjectStatus {
  INITIALIZED = "INITIALIZED",
  DISCOVERING = "DISCOVERING",
  ANALYZING = "ANALYZING",
  TRANSFORMING = "TRANSFORMING",
  VALIDATING = "VALIDATING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
}

export type ProjectMetadata = Readonly<Record<string, string>>;

export type ArtifactRegistry = Readonly<Record<string, Artifact>>;

export interface ProjectState {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly status: ProjectStatus;
  readonly metadata: ProjectMetadata;
  readonly artifacts: ArtifactRegistry;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function freezeProjectState(state: ProjectState): ProjectState {
  const artifacts = Object.fromEntries(
    Object.entries(state.artifacts).map(([id, artifact]) => [id, immutable({ ...artifact })]),
  );

  return immutable({
    ...state,
    artifacts: immutable(artifacts),
    metadata: immutable({ ...state.metadata }),
  });
}
