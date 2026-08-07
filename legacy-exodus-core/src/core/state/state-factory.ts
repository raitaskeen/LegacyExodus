import { randomUUID } from "node:crypto";

import { ProjectStatus, type ProjectState } from "./project-state";
import { validateProjectState } from "./state-schema";

export function createProjectState(name: string): ProjectState {
  const timestamp = new Date();

  return validateProjectState({
    id: randomUUID(),
    name,
    version: 0,
    status: ProjectStatus.INITIALIZED,
    metadata: {},
    artifacts: {},
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}
