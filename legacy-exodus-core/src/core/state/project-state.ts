import type { Artifact } from "./entities";

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
    Object.entries(state.artifacts).map(([id, artifact]) => [id, Object.freeze({ ...artifact })]),
  );

  return Object.freeze({
    ...state,
    artifacts: Object.freeze(artifacts),
    metadata: Object.freeze({ ...state.metadata }),
  });
}
