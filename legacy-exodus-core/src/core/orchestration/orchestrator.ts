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
import { JavaScriptParser, ParserManager, ParserRegistry } from "@parser/index";
import { LegacyExodusError } from "@shared/errors";
import type { StorageManager } from "@storage/index";
import { JavaScriptSymbolExtractor } from "@symbols/index";

import type { RuntimeService } from "@runtime/application";

import {
  DiscoverProjectHandler,
  type CommandExecution,
  AnalyzeProjectHandler,
  InitializeProjectHandler,
  UpdateKnowledgeHandler,
} from "./command-handler";

export type OrchestratorStatus = "idle" | "executing" | "stopped";

export class Orchestrator implements RuntimeService {
  public readonly name = "orchestrator";
  private status: OrchestratorStatus = "idle";
  private activeExecution: Promise<CommandExecution> | null = null;
  private readonly initializeProjectHandler = new InitializeProjectHandler();
  private readonly discoverProjectHandler = new DiscoverProjectHandler();
  private readonly updateKnowledgeHandler = new UpdateKnowledgeHandler();
  private readonly analyzeProjectHandler: AnalyzeProjectHandler;
  private readonly initialState: ProjectState;

  public constructor(
    private readonly eventStore: InMemoryEventStore,
    private readonly eventBus: EventBus,
    private readonly storage: StorageManager,
    discoveryEngine: DiscoveryEngine = new DiscoveryEngine(),
    initialState: ProjectState | undefined = undefined,
    parserManager: ParserManager = createDefaultParserManager(),
    symbolExtractor: JavaScriptSymbolExtractor = new JavaScriptSymbolExtractor(),
  ) {
    this.initialState = initialState ?? createProjectState("Uninitialized Project");
    this.analyzeProjectHandler = new AnalyzeProjectHandler(discoveryEngine, parserManager, symbolExtractor);
  }

  public async execute(command: unknown): Promise<CommandExecution> {
    if (this.status !== "idle") {
      throw new LegacyExodusError({
        code: "ORCHESTRATOR_BUSY",
        message: "The orchestrator is already executing a command.",
      });
    }

    this.status = "executing";

    const executionTask = (async () => {
      const validatedCommand = validateCommand(command);
      const execution = await this.executeValidatedCommand(validatedCommand);

      await this.storage.saveBatch(execution.records);

      for (const event of execution.events) {
        this.eventStore.append(event);
        this.eventBus.publish(event);
      }

      return execution;
    })();

    this.activeExecution = executionTask;

    try {
      return await executionTask;
    } finally {
      if ((this.status as OrchestratorStatus) !== "stopped") {
        this.status = "idle";
      }
      if (this.activeExecution === executionTask) {
        this.activeExecution = null;
      }
    }
  }

  public async stop(): Promise<void> {
    if (this.activeExecution !== null) {
      await this.activeExecution.catch(() => {});
    }
    this.status = "stopped";
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

function createDefaultParserManager(): ParserManager {
  const registry = new ParserRegistry();
  registry.register(new JavaScriptParser());
  return new ParserManager(registry);
}
