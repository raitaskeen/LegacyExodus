import type {
  DiscoverProjectCommand,
  InitializeProjectCommand,
  UpdateKnowledgeCommand,
} from "@contracts/commands";
import type {
  FileDiscovered,
  KnowledgeUpdated,
  ProjectInitialized,
} from "@contracts/events";
import { createDomainEvent } from "@core/events/domain-event";

export class InitializeProjectHandler {
  public handle(command: InitializeProjectCommand): ProjectInitialized {
    return createDomainEvent({
      type: "ProjectInitialized",
      aggregateId: command.payload.projectId,
      payload: {
        projectId: command.payload.projectId,
        name: command.payload.name,
      },
    });
  }
}

export class DiscoverProjectHandler {
  public handle(command: DiscoverProjectCommand): FileDiscovered {
    return createDomainEvent({
      type: "FileDiscovered",
      aggregateId: command.payload.projectId,
      payload: {
        fileId: command.payload.fileId,
        path: command.payload.path,
        language: command.payload.language,
      },
    });
  }
}

export class UpdateKnowledgeHandler {
  public handle(command: UpdateKnowledgeCommand): KnowledgeUpdated {
    return createDomainEvent({
      type: "KnowledgeUpdated",
      aggregateId: command.payload.projectId,
      payload: {
        artifactId: command.payload.artifactId,
      },
    });
  }
}
