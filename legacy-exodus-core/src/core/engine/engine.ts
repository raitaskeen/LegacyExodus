import type { EngineCommand, EngineResult } from "@contracts/engine";
import { LegacyExodusError } from "@shared/errors";

import type { EngineContext } from "./engine-context";
import type { EngineState, EngineStatus } from "./engine-status";

export class LegacyExodusEngine {
  private state: EngineState = "created";

  public constructor(private readonly context: EngineContext) {}

  public async initialize(): Promise<void> {
    if (this.state === "running") {
      return;
    }

    if (this.state === "stopped") {
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

    switch (command.type) {
      case "SystemStatus":
        return { type: "SystemStatus", status: this.status() };
      case "AnalyzeProject": {
        const execution = await this.context.orchestrator.execute(command);

        if (execution.discovery === undefined) {
          throw new LegacyExodusError({
            code: "DISCOVERY_RESULT_MISSING",
            message: "AnalyzeProject completed without a discovery result.",
          });
        }

        const discoveryRecord = execution.records[0];

        if (discoveryRecord === undefined) {
          throw new LegacyExodusError({
            code: "DISCOVERY_RECORD_MISSING",
            message: "AnalyzeProject completed without a discovery record.",
          });
        }

        await this.context.discoveryProjection.project(discoveryRecord.id);

        return { type: "AnalyzeProject", discovery: execution.discovery };
      }
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
