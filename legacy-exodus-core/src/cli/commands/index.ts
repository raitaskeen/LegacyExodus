import type { Command } from "commander";

import { createLegacyExodusEngine } from "@core/engine";

import { registerAnalyzeCommand } from "./analyze";
import { registerInitCommand } from "./init";
import { registerPluginsCommand } from "./plugins";
import { registerStatusCommand } from "./status";
import { registerTestCommand } from "./test";
import { registerVerifyCommand } from "./verify";

export interface CommandRegistrationOptions {
  readonly version: string;
  readonly createEngine: typeof createLegacyExodusEngine;
}

export function registerCommands(program: Command, options: CommandRegistrationOptions): void {
  registerStatusCommand(program, options.version, options.createEngine);
  registerInitCommand(program, options.version);
  registerPluginsCommand(program, options.createEngine);
  registerAnalyzeCommand(program, options.createEngine);
  registerTestCommand(program);
  registerVerifyCommand(program);
}
