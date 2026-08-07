import type { DomainEvent } from "@core/events/domain-event";

export interface ProjectInitializedPayload {
  readonly projectId: string;
  readonly name: string;
}

export interface FileDiscoveredPayload {
  readonly fileId: string;
  readonly path: string;
  readonly language: string;
}

export interface KnowledgeUpdatedPayload {
  readonly artifactId: string;
}

export type ProjectInitialized = DomainEvent<ProjectInitializedPayload, "ProjectInitialized">;

export type FileDiscovered = DomainEvent<FileDiscoveredPayload, "FileDiscovered">;

export type KnowledgeUpdated = DomainEvent<KnowledgeUpdatedPayload, "KnowledgeUpdated">;
