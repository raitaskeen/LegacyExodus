import { LegacyExodusError } from "@shared/errors";

export class ControlFlowInvariantError extends LegacyExodusError {
  public constructor(blockId: string) {
    super({ code: "CONTROL_FLOW_INVARIANT_VIOLATION", message: "Control-flow graph references an unknown block.", metadata: { blockId } });
    this.name = "ControlFlowInvariantError";
  }
}
