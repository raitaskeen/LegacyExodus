import {
  type LegacyExodusCommand,
  validateCommand,
} from "@contracts/commands";
import { createProjectState } from "@core/state/state-factory";
import type { ProjectState } from "@core/state/project-state";
import { EventBus } from "@core/events/event-bus";
import { reduceProjectState } from "@core/events/event-reducer";
import { InMemoryEventStore } from "@core/events/event-store";
import { DiscoveryEngine } from "@discovery/index";
import { LegacyExodusError } from "@shared/errors";
import type { StorageManager } from "@storage/index";

import {
  DiscoverProjectHandler,
  type CommandExecution,
  AnalyzeProjectHandler,
  InitializeProjectHandler,
  UpdateKnowledgeHandler,
} from "./command-handler";

export type OrchestratorStatus = "idle" | "executing";

export class Orchestrator {
  private status: OrchestratorStatus = "idle";
  private readonly initializeProjectHandler = new InitializeProjectHandler();
  private readonly discoverProjectHandler = new DiscoverProjectHandler();
  private readonly updateKnowledgeHandler = new UpdateKnowledgeHandler();
  private readonly analyzeProjectHandler: AnalyzeProjectHandler;

  public constructor(
    private readonly eventStore: InMemoryEventStore,
    private readonly eventBus: EventBus,
    private readonly storage: StorageManager,
    discoveryEngine: DiscoveryEngine = new DiscoveryEngine(),
    private readonly initialState: ProjectState = createProjectState("Uninitialized Project"),
  ) {
    this.analyzeProjectHandler = new AnalyzeProjectHandler(discoveryEngine);
  }

  public async execute(command: unknown): Promise<CommandExecution> {
    if (this.status !== "idle") {
      throw new LegacyExodusError({
        code: "ORCHESTRATOR_BUSY",
        message: "The orchestrator is already executing a command.",
      });
    }

    this.status = "executing";

    try {
      const validatedCommand = validateCommand(command);
      const execution = await this.executeValidatedCommand(validatedCommand);

      for (const record of execution.records) {
        await this.storage.save(record);
      }

      for (const event of execution.events) {
        this.eventStore.append(event);
        this.eventBus.publish(event);
      }

      return execution;
    } finally {
      this.status = "idle";
    }
  }

  public replay(): ProjectState {
    return reduceProjectState(this.initialState, this.eventStore.getAll());
  }

  public getStatus(): OrchestratorStatus {
    return this.status;
  }

  private async executeValidatedCommand(command: LegacyExodusCommand): Promise<CommandExecution> {
    switch (command.type) {
      case "InitializeProject":
        return this.initializeProjectHandler.handle(command);
      case "DiscoverProject":
        return this.discoverProjectHandler.handle(command);
      case "UpdateKnowledge":
        return this.updateKnowledgeHandler.handle(command);
      case "AnalyzeProject":
        return this.analyzeProjectHandler.handle(command);
    }
  }
}
