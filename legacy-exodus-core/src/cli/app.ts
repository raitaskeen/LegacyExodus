import { Command } from "commander";

import { createLegacyExodusEngine } from "@core/engine";

import { registerCommands } from "./commands";
import { detectTerminalCapabilities } from "./presentation/capabilities";
import { HelpPresenter } from "./presentation/help";

export const CLI_VERSION = "0.1.0";

export function createCLI(): Command {
  const program = new Command();

  program
    .name("legacy-exodus")
    .description("Knowledge-first codebase modernization and repository intelligence")
    .version(CLI_VERSION);

  registerCommands(program, {
    version: CLI_VERSION,
    createEngine: () => createLegacyExodusEngine({ ...process.env, LOG_LEVEL: process.env.LOG_LEVEL ?? "silent" }),
  });

  function configureHelpRecursively(cmd: Command): void {
    cmd.configureHelp({
      formatHelp: (currentCmd) => {
        const capabilities = detectTerminalCapabilities();
        const presenter = new HelpPresenter(capabilities);
        if (currentCmd === program) {
          return `${presenter.renderRootHelp(CLI_VERSION)}\n`;
        }
        return `${presenter.renderCommandHelp(currentCmd)}\n`;
      },
    });

    for (const sub of cmd.commands) {
      configureHelpRecursively(sub);
    }
  }

  configureHelpRecursively(program);

  return program;
}
