import type {
  FileDiscovered,
  KnowledgeUpdated,
  ProjectInitialized,
} from "@contracts/events";
import { ProjectStatus, freezeProjectState, type ProjectState } from "@core/state/project-state";

import type { DomainEvent } from "./domain-event";

export function reduceProjectState(
  initialState: ProjectState,
  events: readonly DomainEvent[],
): ProjectState {
  return events.reduce<ProjectState>(reduceEvent, initialState);
}

function reduceEvent(state: ProjectState, event: DomainEvent): ProjectState {
  switch (event.type) {
    case "ProjectInitialized":
      return reduceProjectInitialized(state, event as ProjectInitialized);
    case "FileDiscovered":
      return reduceFileDiscovered(state, event as FileDiscovered);
    case "KnowledgeUpdated":
      return reduceKnowledgeUpdated(state, event as KnowledgeUpdated);
    default:
      return state;
  }
}

function reduceProjectInitialized(state: ProjectState, event: ProjectInitialized): ProjectState {
  return freezeProjectState({
    ...state,
    id: event.payload.projectId,
    name: event.payload.name,
    version: state.version + 1,
    status: ProjectStatus.INITIALIZED,
    createdAt: event.timestamp,
    updatedAt: event.timestamp,
  });
}

function reduceFileDiscovered(state: ProjectState, event: FileDiscovered): ProjectState {
  const discoveredFileCount = Number.parseInt(state.metadata.discoveredFileCount ?? "0", 10) + 1;

  return freezeProjectState({
    ...state,
    version: state.version + 1,
    status: ProjectStatus.DISCOVERING,
    metadata: {
      ...state.metadata,
      discoveredFileCount: String(discoveredFileCount),
      lastDiscoveredFileId: event.payload.fileId,
      lastDiscoveredFilePath: event.payload.path,
      lastDiscoveredFileLanguage: event.payload.language,
    },
    updatedAt: event.timestamp,
  });
}

function reduceKnowledgeUpdated(state: ProjectState, event: KnowledgeUpdated): ProjectState {
  return freezeProjectState({
    ...state,
    version: state.version + 1,
    status: ProjectStatus.ANALYZING,
    artifacts: {
      ...state.artifacts,
      [event.payload.artifactId]: {
        id: event.payload.artifactId,
        type: "knowledge",
        createdAt: event.timestamp,
      },
    },
    updatedAt: event.timestamp,
  });
}
