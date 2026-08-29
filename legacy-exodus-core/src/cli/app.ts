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

  program.addHelpText(
    "after",
    `
Examples:
  $ legacy-exodus status
  $ legacy-exodus analyze ./my-app
  $ legacy-exodus analyze ./my-app --json
  $ legacy-exodus verify

Output Modes:
  Interactive TTY     Formatted presentation with status cards and tables
  CI / Non-TTY        Deterministic plain-text summaries
  --json              Machine-readable JSON emitted to stdout`,
  );

  registerCommands(program, {
    version: CLI_VERSION,
    createEngine: () => createLegacyExodusEngine({ ...process.env, LOG_LEVEL: process.env.LOG_LEVEL ?? "silent" }),
  });

  return program;
}
