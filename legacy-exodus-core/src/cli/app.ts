import { Command } from "commander";

import { createLegacyExodusEngine } from "@core/engine";

import { registerCommands } from "./commands";

export const CLI_VERSION = "0.1.0";

export function createCLI(): Command {
  const program = new Command();

  program
    .name("legacy-exodus")
    .description("Knowledge-first modernization engine")
    .version(CLI_VERSION);

  registerCommands(program, {
    version: CLI_VERSION,
    createEngine: createLegacyExodusEngine,
  });

  return program;
}
