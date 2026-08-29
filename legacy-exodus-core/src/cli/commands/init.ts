import { access, mkdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { Command } from "commander";

import { CliError } from "../errors";
import { formatJsonOutput } from "../output/json-output";
import { detectTerminalCapabilities } from "../presentation/capabilities";
import { SummaryPresenter } from "../presentation/summaries";

export interface InitializationMetadata {
  readonly version: string;
  readonly createdAt: string;
  readonly projectState: "initialized";
}

export interface InitReport {
  readonly workspace: string;
  readonly metadataPath: string;
  readonly metadata: InitializationMetadata;
}

export async function initializeWorkspace(path: string, version: string): Promise<InitReport> {
  const workspace = resolve(path);
  const workspaceStats = await getWorkspaceStats(workspace);

  if (workspaceStats === undefined || !workspaceStats.isDirectory()) {
    throw new CliError("WORKSPACE_INVALID", "The initialization path must be a directory.");
  }

  const metadataDirectory = join(workspace, ".legacy-exodus");
  const metadataPath = join(metadataDirectory, "config.json");

  if (await pathExists(metadataPath)) {
    throw new CliError("WORKSPACE_ALREADY_INITIALIZED", "This workspace is already initialized.");
  }

  const metadata: InitializationMetadata = {
    version,
    createdAt: new Date().toISOString().slice(0, 10),
    projectState: "initialized",
  };

  await mkdir(metadataDirectory, { recursive: true });
  await writeFile(metadataPath, `${formatJsonOutput(metadata)}\n`, "utf8");

  return { workspace, metadataPath, metadata };
}

export function registerInitCommand(program: Command, version: string): void {
  program
    .command("init <path>")
    .description("Initialize a LegacyExodus workspace")
    .option("--json", "Emit machine-readable JSON")
    .action(async (path: string, options: { readonly json?: boolean }): Promise<void> => {
      const report = await initializeWorkspace(path, version);
      if (options.json) {
        process.stdout.write(`${formatJsonOutput(report)}\n`);
        return;
      }

      const capabilities = detectTerminalCapabilities();
      const presenter = new SummaryPresenter(capabilities);
      process.stdout.write(`${presenter.formatInit(report)}\n`);
    });
}

async function getWorkspaceStats(path: string): Promise<Awaited<ReturnType<typeof stat>>> {
  try {
    return await stat(path);
  } catch {
    throw new CliError("WORKSPACE_NOT_FOUND", "The initialization path does not exist.");
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
