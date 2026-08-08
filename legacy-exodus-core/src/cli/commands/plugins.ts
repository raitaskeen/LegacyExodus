import type { Command } from "commander";

import { createLegacyExodusEngine, type LegacyExodusEngine } from "@core/engine";

import { formatPluginListOutput } from "../output/formatter";
import { formatJsonOutput } from "../output/json-output";

export interface PluginListItem {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly type: string;
}

export interface PluginListReport {
  readonly plugins: readonly PluginListItem[];
}

export async function getPluginListReport(
  createEngine: () => LegacyExodusEngine = createLegacyExodusEngine,
): Promise<PluginListReport> {
  const engine = createEngine();

  await engine.initialize();

  try {
    return {
      plugins: engine.listPlugins(),
    };
  } finally {
    await engine.shutdown();
  }
}

export function registerPluginsCommand(
  program: Command,
  createEngine: () => LegacyExodusEngine,
): void {
  program
    .command("plugins")
    .description("Inspect registered LegacyExodus plugins")
    .command("list")
    .description("List registered plugins")
    .option("--json", "Emit machine-readable JSON")
    .action(async (options: { readonly json?: boolean }): Promise<void> => {
      const report = await getPluginListReport(createEngine);
      const output = options.json ? formatJsonOutput(report) : formatPluginListOutput(report);

      process.stdout.write(`${output}\n`);
    });
}
