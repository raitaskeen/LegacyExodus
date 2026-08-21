import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import type { FileArtifact } from "@contracts/discovery";
import { LegacyExodusError } from "@shared/errors";

const ignoredDirectories = new Set([".git", ".legacy-exodus", ".discovery", "node_modules"]);

const languageByExtension: Readonly<Record<string, string>> = {
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hh": "cpp",
  ".hxx": "cpp",
  ".cs": "csharp",
  ".go": "go",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".scala": "scala",
  ".groovy": "groovy",
  ".clj": "clojure",
  ".cljs": "clojure",
  ".cljc": "clojure",
  ".html": "html",
  ".htm": "html",
  ".js": "javascript",
  ".cjs": "javascript",
  ".mjs": "javascript",
  ".jsx": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".vue": "vue",
  ".svelte": "svelte",
  ".css": "css",
  ".scss": "scss",
  ".sass": "sass",
  ".less": "less",
  ".md": "markdown",
  ".mdx": "mdx",
  ".txt": "text",
  ".php": "php",
  ".py": "python",
  ".pyw": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".swift": "swift",
  ".m": "objective-c",
  ".mm": "objective-c",
  ".dart": "dart",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".lua": "lua",
  ".ex": "elixir",
  ".exs": "elixir",
  ".erl": "erlang",
  ".hrl": "erlang",
  ".hs": "haskell",
  ".jl": "julia",
  ".zig": "zig",
  ".pl": "perl",
  ".pm": "perl",
  ".r": "r",
  ".sql": "sql",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".xml": "xml",
};

const knownFiles: Readonly<Record<string, { readonly language: string; readonly fileKind: FileArtifact["fileKind"] }>> = {
  ".gitignore": { language: "gitignore", fileKind: "configuration" },
  "dockerfile": { language: "dockerfile", fileKind: "container" },
  "containerfile": { language: "dockerfile", fileKind: "container" },
  "package.json": { language: "json", fileKind: "manifest" },
  "tsconfig.json": { language: "json", fileKind: "configuration" },
};

const fileKindByExtension: Readonly<Record<string, FileArtifact["fileKind"]>> = {
  ".c": "source", ".h": "source", ".cpp": "source", ".cc": "source", ".cxx": "source", ".hpp": "source", ".hh": "source", ".hxx": "source",
  ".cs": "source", ".go": "source", ".java": "source", ".kt": "source", ".kts": "source", ".scala": "source", ".groovy": "source",
  ".clj": "source", ".cljs": "source", ".cljc": "source",
  ".js": "source", ".cjs": "source", ".mjs": "source", ".jsx": "source", ".ts": "source", ".tsx": "source", ".mts": "source", ".cts": "source",
  ".vue": "source", ".svelte": "source", ".php": "source", ".py": "source", ".pyw": "source", ".rb": "source", ".rs": "source",
  ".swift": "source", ".m": "source", ".mm": "source", ".dart": "source", ".sh": "source", ".bash": "source", ".zsh": "source",
  ".lua": "source", ".ex": "source", ".exs": "source", ".erl": "source", ".hrl": "source", ".hs": "source", ".jl": "source", ".zig": "source",
  ".pl": "source", ".pm": "source", ".r": "source",
  ".html": "markup", ".htm": "markup", ".md": "documentation", ".mdx": "documentation", ".txt": "documentation",
  ".css": "stylesheet", ".scss": "stylesheet", ".sass": "stylesheet", ".less": "stylesheet",
  ".json": "data", ".yaml": "data", ".yml": "data", ".toml": "data", ".xml": "data",
  ".sql": "database-schema", ".dockerignore": "container",
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

    const known = knownFiles[path.split("/").at(-1)?.toLowerCase() ?? ""];
    return Object.freeze({
      id: createHash("sha256").update(path).digest("hex"),
      path,
      language: known?.language ?? languageByExtension[extension] ?? "unknown",
      fileKind: known?.fileKind ?? fileKindByExtension[extension] ?? "unknown",
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
