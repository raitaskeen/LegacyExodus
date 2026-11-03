import {
  type LegacyExodusCommand,
  validateCommand,
} from "@contracts/commands";
import { createProjectState } from "@core/state/state-factory";
import type { ProjectState } from "@core/state/project-state";
import { EventBus } from "@core/events/event-bus";
import { createDurableEventRecord, loadDurableEvents } from "@core/events/durable-event-journal";
import { reduceProjectState } from "@core/events/event-reducer";
import { InMemoryEventStore } from "@core/events/event-store";
import { DiscoveryEngine, type DiscoveryValidator } from "@discovery/index";
import { JavaScriptParser, ParserManager, ParserRegistry } from "@parser/index";
import { LegacyExodusError } from "@shared/errors";
import type { StorageManager } from "@storage/index";
import { JavaScriptSymbolExtractor } from "@symbols/index";

import type { RuntimeService } from "@runtime/application";

import {
  DiscoverProjectHandler,
  type AstStoreCleanupFailure,
  type CommandExecution,
  AnalyzeProjectHandler,
  InitializeProjectHandler,
  UpdateKnowledgeHandler,
} from "./command-handler";
import type { AnalysisAstStoreFactory } from "./run-scoped-ast-store";

export type OrchestratorStatus = "idle" | "executing" | "stopped";

export interface PostCommitEventDeliveryFailure {
  readonly stage: "delivery" | "reporting";
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateId: string;
  readonly error: unknown;
}

export type PostCommitEventDeliveryFailureReporter = (
  failure: PostCommitEventDeliveryFailure,
) => void;

export interface AstStoreCleanupDiagnostic extends AstStoreCleanupFailure {
  readonly stage: "cleanup" | "reporting";
}

export type AstStoreCleanupFailureReporter = (
  failure: AstStoreCleanupDiagnostic,
) => void;

export class Orchestrator implements RuntimeService {
  public readonly name = "orchestrator";
  private status: OrchestratorStatus = "idle";
  private activeExecution: Promise<CommandExecution> | null = null;
  private readonly initializeProjectHandler = new InitializeProjectHandler();
  private readonly discoverProjectHandler = new DiscoverProjectHandler();
  private readonly updateKnowledgeHandler = new UpdateKnowledgeHandler();
  private readonly analyzeProjectHandler: AnalyzeProjectHandler;
  private readonly initialState: ProjectState;
  private postCommitEventDeliveryFailures: PostCommitEventDeliveryFailure[] = [];
  private astStoreCleanupFailures: AstStoreCleanupDiagnostic[] = [];

  public constructor(
    private readonly eventStore: InMemoryEventStore,
    private readonly eventBus: EventBus,
    private readonly storage: StorageManager,
    discoveryEngine: DiscoveryEngine = new DiscoveryEngine(),
    initialState: ProjectState | undefined = undefined,
    parserManager: ParserManager = createDefaultParserManager(),
    symbolExtractor: JavaScriptSymbolExtractor = new JavaScriptSymbolExtractor(),
    private readonly reportPostCommitEventDeliveryFailure?: PostCommitEventDeliveryFailureReporter,
    astStoreFactory?: AnalysisAstStoreFactory,
    private readonly reportAstStoreCleanupFailure?: AstStoreCleanupFailureReporter,
    discoveryValidator?: DiscoveryValidator,
  ) {
    this.initialState = initialState ?? createProjectState("Uninitialized Project");
    this.analyzeProjectHandler = new AnalyzeProjectHandler(
      discoveryEngine,
      parserManager,
      symbolExtractor,
      discoveryValidator,
      astStoreFactory,
    );
  }

  public async execute(command: unknown): Promise<CommandExecution> {
    if (this.status !== "idle") {
      throw new LegacyExodusError({
        code: "ORCHESTRATOR_BUSY",
        message: "The orchestrator is already executing a command.",
      });
    }

    this.status = "executing";
    this.postCommitEventDeliveryFailures = [];
    this.astStoreCleanupFailures = [];

    const executionTask = (async () => {
      const validatedCommand = validateCommand(command);
      const execution = await this.executeValidatedCommand(validatedCommand);

      if (validatedCommand.type === "AnalyzeProject") {
        for (const cleanupFailure of this.analyzeProjectHandler.getAstStoreCleanupFailures()) {
          const diagnostic = Object.freeze({ ...cleanupFailure, stage: "cleanup" as const });
          this.astStoreCleanupFailures.push(diagnostic);
          try {
            this.reportAstStoreCleanupFailure?.(diagnostic);
          } catch (reportingError: unknown) {
            this.astStoreCleanupFailures.push(Object.freeze({
              ...cleanupFailure,
              stage: "reporting" as const,
              error: reportingError,
            }));
          }
        }
      }

      const analysisRunId = validatedCommand.type === "AnalyzeProject" ? validatedCommand.id : undefined;

      // Facts and their ordered event journal are committed in a single atomic transaction.
      // EventBus delivery is deliberately post-commit and can be retried/replayed from this durable journal.
      await this.storage.commitBatch({
        records: execution.records,
        events: execution.events.map((event) => ({
          aggregateId: event.aggregateId,
          createRecord: (sequence: number) => createDurableEventRecord(event, sequence, analysisRunId),
        })),
      });

      for (const event of execution.events) {
        this.eventStore.append(event);
        try {
          this.eventBus.publish(event);
        } catch (error: unknown) {
          const failure = Object.freeze({
            stage: "delivery" as const,
            eventId: event.id,
            eventType: event.type,
            aggregateId: event.aggregateId,
            error,
          });
          this.postCommitEventDeliveryFailures.push(failure);

          try {
            this.reportPostCommitEventDeliveryFailure?.(failure);
          } catch (reportingError: unknown) {
            this.postCommitEventDeliveryFailures.push(Object.freeze({
              stage: "reporting" as const,
              eventId: event.id,
              eventType: event.type,
              aggregateId: event.aggregateId,
              error: reportingError,
            }));
          }
        }
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

  /** Removes the fact lists of past runs (ADR-009); only when no record references them any more. */
  public releaseFacts(): void {
    this.analyzeProjectHandler.disposeFacts();
  }

  public async stop(): Promise<void> {
    if (this.activeExecution !== null) {
      await this.activeExecution.catch(() => {});
    }
    this.status = "stopped";
    // The engine stops services only after its executions (projections included) have settled.
    this.analyzeProjectHandler.disposeFacts();
  }

  public replay(): ProjectState {
    return reduceProjectState(this.initialState, this.eventStore.getAll());
  }

  /** Reconstructs state after a process restart from the durable event journal. */
  public async replayDurable(projectId: string, analysisRunId?: string): Promise<ProjectState> {
    return reduceProjectState(this.initialState, await loadDurableEvents(this.storage, projectId, analysisRunId));
  }

  public getStatus(): OrchestratorStatus {
    return this.status;
  }

  public getPostCommitEventDeliveryFailures(): readonly PostCommitEventDeliveryFailure[] {
    return Object.freeze([...this.postCommitEventDeliveryFailures]);
  }

  public getAstStoreCleanupFailures(): readonly AstStoreCleanupDiagnostic[] {
    return Object.freeze([...this.astStoreCleanupFailures]);
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
