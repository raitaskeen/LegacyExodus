import type { EngineStatus } from "@core/engine/engine-status";
import type { ProjectDiscovery } from "@contracts/discovery";
import type { AnalyzeProjectCommand } from "./commands";

export interface SystemStatusCommand {
  readonly id: string;
  readonly type: "SystemStatus";
  readonly createdAt: Date;
}

export type EngineCommand = SystemStatusCommand | AnalyzeProjectCommand;

export interface SystemStatusResult {
  readonly type: "SystemStatus";
  readonly status: EngineStatus;
}

export interface AnalyzeProjectResult {
  readonly type: "AnalyzeProject";
  readonly discovery: ProjectDiscovery;
}

export type EngineResult = SystemStatusResult | AnalyzeProjectResult;
