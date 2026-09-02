import type {
  AnalysisRunCompleted,
  AnalysisRunFailed,
  DependencyDetected,
  DiscoveryCompleted,
  FileDiscovered,
  FrameworkDetected,
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
    case "DependencyDetected":
      return reduceDependencyDetected(state, event as DependencyDetected);
    case "FrameworkDetected":
      return reduceFrameworkDetected(state, event as FrameworkDetected);
    case "DiscoveryCompleted":
      return reduceDiscoveryCompleted(state, event as DiscoveryCompleted);
    case "AnalysisRunCompleted":
      return reduceAnalysisRunCompleted(state, event as AnalysisRunCompleted);
    case "AnalysisRunFailed":
      return reduceAnalysisRunFailed(state, event as AnalysisRunFailed);
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

function reduceDependencyDetected(state: ProjectState, event: DependencyDetected): ProjectState {
  const dependencyCount = Number.parseInt(state.metadata.dependencyCount ?? "0", 10) + 1;

  return freezeProjectState({
    ...state,
    version: state.version + 1,
    metadata: {
      ...state.metadata,
      dependencyCount: String(dependencyCount),
      lastDependencyName: event.payload.name,
      lastDependencyVersion: event.payload.version,
    },
    updatedAt: event.timestamp,
  });
}

function reduceFrameworkDetected(state: ProjectState, event: FrameworkDetected): ProjectState {
  const frameworkCount = Number.parseInt(state.metadata.frameworkCount ?? "0", 10) + 1;

  return freezeProjectState({
    ...state,
    version: state.version + 1,
    metadata: {
      ...state.metadata,
      frameworkCount: String(frameworkCount),
      lastFrameworkName: event.payload.name,
      lastFrameworkEvidence: event.payload.evidence,
    },
    updatedAt: event.timestamp,
  });
}

function reduceDiscoveryCompleted(state: ProjectState, event: DiscoveryCompleted): ProjectState {
  return freezeProjectState({
    ...state,
    id: event.payload.projectId,
    version: state.version + 1,
    status: ProjectStatus.ANALYZING,
    metadata: {
      ...state.metadata,
      discoveryStatus: "completed",
      discoveredFileCount: String(event.payload.fileCount),
      dependencyCount: String(event.payload.dependencyCount),
      frameworkCount: String(event.payload.frameworkCount),
    },
    updatedAt: event.timestamp,
  });
}

function reduceAnalysisRunCompleted(state: ProjectState, event: AnalysisRunCompleted): ProjectState {
  return freezeProjectState({
    ...state,
    id: event.payload.projectId,
    version: state.version + 1,
    status: ProjectStatus.COMPLETED,
    metadata: {
      ...state.metadata,
      analysisStatus: "completed",
      analysisRunId: event.payload.analysisRunId,
      analysisDurationMs: String(event.payload.durationMs),
    },
    updatedAt: event.timestamp,
  });
}

function reduceAnalysisRunFailed(state: ProjectState, event: AnalysisRunFailed): ProjectState {
  return freezeProjectState({
    ...state,
    id: event.payload.projectId,
    version: state.version + 1,
    status: ProjectStatus.FAILED,
    metadata: {
      ...state.metadata,
      analysisStatus: "failed",
      analysisRunId: event.payload.analysisRunId,
      analysisError: event.payload.error,
    },
    updatedAt: event.timestamp,
  });
}
