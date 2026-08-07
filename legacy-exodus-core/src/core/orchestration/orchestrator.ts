import {
  type LegacyExodusCommand,
  validateCommand,
} from "@contracts/commands";
import { createProjectState } from "@core/state/state-factory";
import type { ProjectState } from "@core/state/project-state";
import { EventBus } from "@core/events/event-bus";
import type { DomainEvent } from "@core/events/domain-event";
import { reduceProjectState } from "@core/events/event-reducer";
import { InMemoryEventStore } from "@core/events/event-store";
import { LegacyExodusError } from "@shared/errors";

import {
  DiscoverProjectHandler,
  InitializeProjectHandler,
  UpdateKnowledgeHandler,
} from "./command-handler";

export type OrchestratorStatus = "idle" | "executing";

export class Orchestrator {
  private status: OrchestratorStatus = "idle";
  private readonly initializeProjectHandler = new InitializeProjectHandler();
  private readonly discoverProjectHandler = new DiscoverProjectHandler();
  private readonly updateKnowledgeHandler = new UpdateKnowledgeHandler();

  public constructor(
    private readonly eventStore: InMemoryEventStore = new InMemoryEventStore(),
    private readonly eventBus: EventBus = new EventBus(),
    private readonly initialState: ProjectState = createProjectState("Uninitialized Project"),
  ) {}

  public execute(command: unknown): DomainEvent {
    if (this.status !== "idle") {
      throw new LegacyExodusError({
        code: "ORCHESTRATOR_BUSY",
        message: "The orchestrator is already executing a command.",
      });
    }

    this.status = "executing";

    try {
      const validatedCommand = validateCommand(command);
      const event = this.executeValidatedCommand(validatedCommand);

      this.eventStore.append(event);
      this.eventBus.publish(event);

      return event;
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

  private executeValidatedCommand(command: LegacyExodusCommand): DomainEvent {
    switch (command.type) {
      case "InitializeProject":
        return this.initializeProjectHandler.handle(command);
      case "DiscoverProject":
        return this.discoverProjectHandler.handle(command);
      case "UpdateKnowledge":
        return this.updateKnowledgeHandler.handle(command);
    }
  }
}
