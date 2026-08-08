import type { RuntimeStatus } from "@runtime/application";

export type EngineState = "created" | "running" | "stopped";
export type EngineComponentStatus = "ready" | "not-ready";

export interface EngineStatus {
  readonly state: EngineState;
  readonly runtime: RuntimeStatus;
  readonly components: {
    readonly events: EngineComponentStatus;
    readonly plugins: EngineComponentStatus;
    readonly storage: EngineComponentStatus;
  };
}
