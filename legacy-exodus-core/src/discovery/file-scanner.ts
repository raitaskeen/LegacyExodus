import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import type { FileArtifact } from "@contracts/discovery";
import { LegacyExodusError } from "@shared/errors";

const ignoredDirectories = new Set([".git", ".legacy-exodus", ".discovery", "node_modules"]);

const languageByExtension: Readonly<Record<string, string>> = {
  ".c": "c",
  ".cs": "csharp",
  ".go": "go",
  ".java": "java",
  ".js": "javascript",
  ".cjs": "javascript",
  ".mjs": "javascript",
  ".jsx": "javascript",
  ".php": "php",
  ".py": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".ts": "typescript",
  ".tsx": "typescript",
};

export class FileScanner {
  public async scan(projectPath: string): Promise<readonly FileArtifact[]> {
    const resolvedProjectPath = resolve(projectPath);
    const projectStats = await this.getProjectStats(resolvedProjectPath);

    if (projectStats === undefined || !projectStats.isDirectory()) {
      throw new LegacyExodusError({
        code: "DISCOVERY_PATH_INVALID",
        message: "Discovery path must be a directory.",
        metadata: { projectPath: resolvedProjectPath },
      });
    }

    const files = await this.scanDirectory(resolvedProjectPath, resolvedProjectPath);

    return Object.freeze(files);
  }

  private async scanDirectory(
    projectPath: string,
    currentPath: string,
  ): Promise<FileArtifact[]> {
    const entries = await readdir(currentPath, { withFileTypes: true });
    const files: FileArtifact[] = [];

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = resolve(currentPath, entry.name);

      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          files.push(...(await this.scanDirectory(projectPath, entryPath)));
        }

        continue;
      }

      if (entry.isFile()) {
        files.push(await this.createFileArtifact(projectPath, entryPath));
      }
    }

    return files;
  }

  private async createFileArtifact(projectPath: string, filePath: string): Promise<FileArtifact> {
    const fileStats = await stat(filePath);
    const path = relative(projectPath, filePath).split(sep).join("/");
    const extensionIndex = path.lastIndexOf(".");
    const extension = extensionIndex < 0 ? "" : path.slice(extensionIndex).toLowerCase();

    return Object.freeze({
      id: createHash("sha256").update(path).digest("hex"),
      path,
      language: languageByExtension[extension] ?? "unknown",
      size: fileStats.size,
    });
  }

  private async getProjectStats(projectPath: string): Promise<Awaited<ReturnType<typeof stat>>> {
    try {
      return await stat(projectPath);
    } catch {
      throw new LegacyExodusError({
        code: "DISCOVERY_PATH_NOT_FOUND",
        message: "Discovery path does not exist.",
        metadata: { projectPath },
      });
    }
  }
}
