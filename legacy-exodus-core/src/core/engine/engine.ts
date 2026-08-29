import type { EngineCommand, EngineResult } from "@contracts/engine";
import { LegacyExodusError } from "@shared/errors";

import type { EngineContext } from "./engine-context";
import type { EngineState, EngineStatus } from "./engine-status";

export class LegacyExodusEngine {
  private state: EngineState = "created";
  private readonly activeExecutions = new Set<Promise<unknown>>();

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
    this.state = "running";
  }

  public async shutdown(): Promise<void> {
    if (this.state === "stopped") {
      return;
    }

    this.state = "stopping";

    if (this.activeExecutions.size > 0) {
      await Promise.allSettled([...this.activeExecutions]);
    }

    await this.context.runtime.shutdown();
    this.state = "stopped";
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

          await this.context.discoveryProjection.project(discoveryRecord.id);

          if (execution.analysis === undefined) {
            throw new LegacyExodusError({
              code: "ANALYSIS_SUMMARY_MISSING",
              message: "AnalyzeProject completed without an analysis summary.",
            });
          }

          return { type: "AnalyzeProject" as const, discovery: execution.discovery, analysis: execution.analysis };
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
