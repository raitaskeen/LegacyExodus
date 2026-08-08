import type {
  AnalyzeProjectCommand,
  DiscoverProjectCommand,
  InitializeProjectCommand,
  UpdateKnowledgeCommand,
} from "@contracts/commands";
import type {
  FileDiscovered,
  KnowledgeUpdated,
  ProjectInitialized,
} from "@contracts/events";
import { createDomainEvent, type DomainEvent } from "@core/events/domain-event";
import { DiscoveryEngine, type DiscoveryResult } from "@discovery/index";
import { createStorageRecord, type StorageRecord } from "@storage/index";

export interface CommandExecution {
  readonly events: readonly DomainEvent[];
  readonly records: readonly StorageRecord[];
  readonly discovery?: DiscoveryResult;
}

export class InitializeProjectHandler {
  public handle(command: InitializeProjectCommand): CommandExecution {
    const event: ProjectInitialized = createDomainEvent({
      type: "ProjectInitialized",
      aggregateId: command.payload.projectId,
      payload: {
        projectId: command.payload.projectId,
        name: command.payload.name,
      },
    });

    return { events: Object.freeze([event]), records: Object.freeze([]) };
  }
}

export class DiscoverProjectHandler {
  public handle(command: DiscoverProjectCommand): CommandExecution {
    const event: FileDiscovered = createDomainEvent({
      type: "FileDiscovered",
      aggregateId: command.payload.projectId,
      payload: {
        fileId: command.payload.fileId,
        path: command.payload.path,
        language: command.payload.language,
      },
    });

    return { events: Object.freeze([event]), records: Object.freeze([]) };
  }
}

export class UpdateKnowledgeHandler {
  public handle(command: UpdateKnowledgeCommand): CommandExecution {
    const event: KnowledgeUpdated = createDomainEvent({
      type: "KnowledgeUpdated",
      aggregateId: command.payload.projectId,
      payload: {
        artifactId: command.payload.artifactId,
      },
    });

    return { events: Object.freeze([event]), records: Object.freeze([]) };
  }
}

export class AnalyzeProjectHandler {
  public constructor(private readonly discoveryEngine: DiscoveryEngine) {}

  public async handle(command: AnalyzeProjectCommand): Promise<CommandExecution> {
    const discovery = await this.discoveryEngine.discover({
      projectId: command.payload.projectId,
      projectPath: command.payload.path,
    });
    const record = createStorageRecord("project-discovery", {
      projectId: discovery.projectId,
      projectName: discovery.projectName,
      projectPath: discovery.projectPath,
      files: discovery.files.map((file) => ({ ...file })),
      dependencies: discovery.dependencies.map((dependency) => ({ ...dependency })),
      frameworks: discovery.frameworks.map((framework) => ({ ...framework })),
      languages: [...discovery.languages],
      discoveredAt: discovery.discoveredAt.toISOString(),
    });

    return {
      events: this.discoveryEngine.createEvents(discovery),
      records: Object.freeze([record]),
      discovery,
    };
  }
}
