import type { Command } from "commander";

import { createLegacyExodusEngine, type LegacyExodusEngine } from "@core/engine";

import { formatJsonOutput } from "../output/json-output";
import { detectTerminalCapabilities } from "../presentation/capabilities";
import { SummaryPresenter } from "../presentation/summaries";

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
    .option("--theme <name>", "Visual theme (classic, aurora, mono)")
    .action(async (options: { readonly json?: boolean; readonly theme?: string }): Promise<void> => {
      const report = await getPluginListReport(createEngine);
      if (options.json) {
        process.stdout.write(`${formatJsonOutput(report)}\n`);
        return;
      }

      const capabilities = detectTerminalCapabilities({ json: options.json, theme: options.theme });
      const presenter = new SummaryPresenter(capabilities);
      process.stdout.write(`${presenter.formatPlugins(report)}\n`);
    });
}
