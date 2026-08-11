import type { Command } from "commander";

import {
  createLegacyExodusEngine,
  type EngineStatus,
  type LegacyExodusEngine,
} from "@core/engine";

import { formatStatusOutput } from "../output/formatter";
import { formatJsonOutput } from "../output/json-output";

export interface StatusReport {
  readonly runtime: EngineStatus["runtime"];
  readonly storage: "ready" | "not-ready";
  readonly plugins: number;
  readonly version: string;
}

export type EngineFactory = () => LegacyExodusEngine;

export async function getStatusReport(
  version: string,
  createEngine: EngineFactory = createLegacyExodusEngine,
): Promise<StatusReport> {
  const engine = createEngine();

  await engine.initialize();

  try {
    const status = engine.status();

    return {
      runtime: status.runtime,
      storage: status.components.storage === "ready" ? "ready" : "not-ready",
      plugins: engine.listPlugins().length,
      version,
    };
  } finally {
    await engine.shutdown();
  }
}

export function registerStatusCommand(
  program: Command,
  version: string,
  createEngine: EngineFactory,
): void {
  program
    .command("status")
    .description("Report runtime health and composed dependencies")
    .option("--json", "Emit machine-readable JSON")
    .action(async (options: { readonly json?: boolean }): Promise<void> => {
      const report = await getStatusReport(version, createEngine);
      const output = options.json ? formatJsonOutput(report) : formatStatusOutput(report);

      process.stdout.write(`${output}\n`);
    });
}
