import type { EngineCommand, EngineResult } from "@contracts/engine";
import { LegacyExodusError } from "@shared/errors";

import type { EngineContext } from "./engine-context";
import type { EngineState, EngineStatus } from "./engine-status";

export class LegacyExodusEngine {
  private state: EngineState = "created";
  private readonly activeExecutions = new Set<Promise<unknown>>();
  private resetPromise: Promise<void> | null = null;
  private shutdownPromise: Promise<void> | null = null;

  public constructor(private readonly context: EngineContext) {}

  public async initialize(): Promise<void> {
    if (this.state === "running") {
      return;
    }

    if (this.state === "stopping" || this.state === "stopped") {
      throw new LegacyExodusError({
        code: "ENGINE_RESTART_NOT_SUPPORTED",
        message: "A stopped engine instance cannot be restarted.",
      });
    }

    await this.context.runtime.start();

    if (["stopping", "stopped"].includes(this.state)) {
      throw new LegacyExodusError({
        code: "ENGINE_RESTART_NOT_SUPPORTED",
        message: "Initialization cannot complete because engine shutdown has begun.",
      });
    }

    this.state = "running";
  }

  public shutdown(): Promise<void> {
    if (this.state === "stopped") {
      return Promise.resolve();
    }

    if (this.shutdownPromise !== null) {
      return this.shutdownPromise;
    }

    this.state = "stopping";

    this.shutdownPromise = (async () => {
      try {
        if (this.resetPromise !== null) {
          await Promise.allSettled([this.resetPromise]);
        }

        if (this.activeExecutions.size > 0) {
          await Promise.allSettled([...this.activeExecutions]);
        }

        await this.context.runtime.shutdown();
      } finally {
        this.state = "stopped";
      }
    })();

    return this.shutdownPromise;
  }

  public resetSession(): Promise<void> {
    if (this.state !== "running") {
      throw new LegacyExodusError({
        code: "ENGINE_NOT_RUNNING",
        message: "The engine must be running before its session can be reset.",
      });
    }

    if (this.resetPromise !== null) {
      return this.resetPromise;
    }

    if (this.activeExecutions.size > 0) {
      throw new LegacyExodusError({
        code: "ENGINE_BUSY",
        message: "The engine cannot reset its session while a command is executing.",
      });
    }

    const operation = Promise.resolve()
      .then(async () => {
        await this.context.storage.clearTransient();
        this.context.eventStore.clear();
        // No record references a fact list now: in-memory records are gone, persisted ones hold the lists inline.
        this.context.orchestrator.releaseFacts();
      })
      .finally(() => {
        this.resetPromise = null;
      });

    this.resetPromise = operation;
    return operation;
  }

  public status(): EngineStatus {
    const componentsReady = this.state === "running";

    return {
      state: this.state,
      runtime: this.context.runtime.getStatus(),
      components: {
        events: componentsReady ? "ready" : "not-ready",
        plugins: componentsReady ? "ready" : "not-ready",
        storage: componentsReady ? "ready" : "not-ready",
      },
    };
  }

  public async execute(command: EngineCommand): Promise<EngineResult> {
    if (this.state !== "running") {
      throw new LegacyExodusError({
        code: "ENGINE_NOT_RUNNING",
        message: "The engine must be initialized before command execution.",
      });
    }

    if (this.resetPromise !== null) {
      throw new LegacyExodusError({
        code: "ENGINE_BUSY",
        message: "The engine cannot execute commands while its session is being reset.",
      });
    }

    const executionPromise = (async () => {
      switch (command.type) {
        case "SystemStatus":
          return { type: "SystemStatus" as const, status: this.status() };
        case "AnalyzeProject": {
          const execution = await this.context.orchestrator.execute(command);

          const failedEvent = execution.events.find((event) => event.type === "AnalysisRunFailed");
          if (failedEvent !== undefined) {
            const payload = failedEvent.payload as { readonly error: string };
            throw new LegacyExodusError({
              code: "ANALYSIS_RUN_FAILED",
              message: `Analysis run failed: ${payload.error}`,
              metadata: {
                projectId: command.payload.projectId,
                analysisRunId: command.id,
                error: payload.error,
              },
            });
          }

          if (execution.discovery === undefined) {
            throw new LegacyExodusError({
              code: "DISCOVERY_RESULT_MISSING",
              message: "AnalyzeProject completed without a discovery result.",
            });
          }

          const discoveryRecord = execution.records.find((record) => record.type === "project-discovery");

          if (discoveryRecord === undefined) {
            throw new LegacyExodusError({
              code: "DISCOVERY_RECORD_MISSING",
              message: "AnalyzeProject completed without a discovery record.",
            });
          }

          if (!execution.isReused) {
            try {
              await this.context.discoveryProjection.project(discoveryRecord.id);
            } catch (error: unknown) {
              throw new LegacyExodusError({
                code: "DISCOVERY_PROJECTION_FAILED_AFTER_COMMIT",
                message: "Analysis was committed, but discovery artifact projection failed.",
                metadata: {
                  context: "Discovery Projection",
                  projectId: command.payload.projectId,
                  analysisRunId: command.id,
                  projectPath: execution.discovery.projectPath,
                  analysisCommitted: true,
                  projectionStatus: "failed",
                  causeCode: error instanceof LegacyExodusError ? error.code : "UNKNOWN_PROJECTION_FAILURE",
                  error: error instanceof Error ? error.message : String(error),
                },
                cause: error,
              });
            }
          }

          if (execution.analysis === undefined) {
            throw new LegacyExodusError({
              code: "ANALYSIS_SUMMARY_MISSING",
              message: "AnalyzeProject completed without an analysis summary.",
            });
          }

          return {
            type: "AnalyzeProject" as const,
            discovery: execution.discovery,
            analysis: execution.analysis,
            ...(execution.isReused === true ? { isReused: true } : {}),
            ...(execution.isReused === true && execution.snapshotAnalysisRunId !== undefined
              ? { snapshotAnalysisRunId: execution.snapshotAnalysisRunId }
              : {}),
          };
        }
      }
    })();

    this.activeExecutions.add(executionPromise);
    try {
      return await executionPromise;
    } finally {
      this.activeExecutions.delete(executionPromise);
    }
  }

  public listPlugins(): readonly {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly type: string;
  }[] {
    return this.context.plugins.list().map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      type: plugin.type,
    }));
  }
}
