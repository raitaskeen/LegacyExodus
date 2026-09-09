import { lstat, mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

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

  await ensureSafeMetadataDirectory(workspace, metadataDirectory);
  await ensureSafeConfigDestination(metadataPath);

  const metadata: InitializationMetadata = {
    version,
    createdAt: new Date().toISOString().slice(0, 10),
    projectState: "initialized",
  };

  try {
    await writeFile(metadataPath, `${formatJsonOutput(metadata)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (error: unknown) {
    if (isFileSystemError(error, "EEXIST")) {
      await ensureSafeConfigDestination(metadataPath);
      throw new CliError("WORKSPACE_ALREADY_INITIALIZED", "This workspace is already initialized.");
    }

    throw error;
  }

  return { workspace, metadataPath, metadata };
}

export function registerInitCommand(program: Command, version: string): void {
  program
    .command("init <path>")
    .description("Initialize a LegacyExodus workspace")
    .option("--json", "Emit machine-readable JSON")
    .option("--theme <name>", "Visual theme (classic, aurora, mono)")
    .action(async (path: string, options: { readonly json?: boolean; readonly theme?: string }): Promise<void> => {
      const report = await initializeWorkspace(path, version);
      if (options.json) {
        process.stdout.write(`${formatJsonOutput(report)}\n`);
        return;
      }

      const capabilities = detectTerminalCapabilities({ json: options.json, theme: options.theme });
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

async function ensureSafeMetadataDirectory(workspace: string, metadataDirectory: string): Promise<void> {
  const workspaceRoot = await realpath(workspace);
  let metadataStats = await tryLstat(metadataDirectory);

  if (metadataStats === undefined) {
    try {
      await mkdir(metadataDirectory);
    } catch (error: unknown) {
      if (!isFileSystemError(error, "EEXIST")) {
        throw error;
      }
    }

    metadataStats = await tryLstat(metadataDirectory);
  }

  if (metadataStats === undefined || metadataStats.isSymbolicLink() || !metadataStats.isDirectory()) {
    throw unsafeMetadataPathError();
  }

  const physicalMetadataDirectory = await realpath(metadataDirectory);
  if (!isContainedPath(workspaceRoot, physicalMetadataDirectory)) {
    throw unsafeMetadataPathError();
  }
}

async function ensureSafeConfigDestination(metadataPath: string): Promise<void> {
  const metadataStats = await tryLstat(metadataPath);
  if (metadataStats === undefined) {
    return;
  }

  if (metadataStats.isSymbolicLink() || !metadataStats.isFile()) {
    throw unsafeMetadataPathError();
  }

  throw new CliError("WORKSPACE_ALREADY_INITIALIZED", "This workspace is already initialized.");
}

async function tryLstat(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path);
  } catch (error: unknown) {
    if (isFileSystemError(error, "ENOENT")) {
      return undefined;
    }

    throw error;
  }
}

function isContainedPath(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === "" || (!isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith(`..${sep}`));
}

function isFileSystemError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function unsafeMetadataPathError(): CliError {
  return new CliError("WORKSPACE_METADATA_UNSAFE", "The LegacyExodus metadata path is not a safe directory.");
}
