import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import type { DiscoveryEnumerationFailure, ExcludedPath, FileArtifact, FileScanResult } from "@contracts/discovery";
import { LegacyExodusError } from "@shared/errors";
import { compareCodePoints } from "@shared/ordering";

import { IgnoreRules } from "./ignore-rules";

export type { FileScanResult };

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
  ".svg": "svg",
  ".drawio": "xml",
  "._js_": "text",
  "._ts_": "text",
  ".png": "binary",
  ".jpg": "binary",
  ".jpeg": "binary",
  ".gif": "binary",
  ".ico": "binary",
  ".webp": "binary",
  ".pdf": "binary",
  ".wasm": "binary",
  ".lock": "data",
  ".lockb": "binary",
  ".map": "data",
  ".crt": "pem",
  ".key": "pem",
  ".pem": "pem",
  ".cert": "pem",
};

const knownFiles: Readonly<Record<string, { readonly language: string; readonly fileKind: FileArtifact["fileKind"] }>> = {
  ".gitignore": { language: "gitignore", fileKind: "configuration" },
  ".gitattributes": { language: "gitattributes", fileKind: "configuration" },
  ".gitkeep": { language: "gitignore", fileKind: "configuration" },
  ".eslintignore": { language: "ignore", fileKind: "configuration" },
  ".npmignore": { language: "ignore", fileKind: "configuration" },
  ".prettierignore": { language: "ignore", fileKind: "configuration" },
  ".dockerignore": { language: "ignore", fileKind: "container" },
  ".editorconfig": { language: "ini", fileKind: "configuration" },
  ".npmrc": { language: "ini", fileKind: "configuration" },
  ".taprc": { language: "yaml", fileKind: "configuration" },
  ".prettierrc": { language: "json", fileKind: "configuration" },
  ".eslintrc": { language: "json", fileKind: "configuration" },
  ".babelrc": { language: "json", fileKind: "configuration" },
  ".env": { language: "shell", fileKind: "configuration" },
  ".env.example": { language: "shell", fileKind: "configuration" },
  "dockerfile": { language: "dockerfile", fileKind: "container" },
  "containerfile": { language: "dockerfile", fileKind: "container" },
  "package.json": { language: "json", fileKind: "manifest" },
  "package-lock.json": { language: "json", fileKind: "manifest" },
  "tsconfig.json": { language: "json", fileKind: "configuration" },
  "license": { language: "text", fileKind: "documentation" },
  "license.md": { language: "markdown", fileKind: "documentation" },
  "license.txt": { language: "text", fileKind: "documentation" },
  "licence": { language: "text", fileKind: "documentation" },
  "licence.md": { language: "markdown", fileKind: "documentation" },
  "licence.txt": { language: "text", fileKind: "documentation" },
  "copying": { language: "text", fileKind: "documentation" },
  "notice": { language: "text", fileKind: "documentation" },
  "authors": { language: "text", fileKind: "documentation" },
  "contributors": { language: "text", fileKind: "documentation" },
  "changelog": { language: "text", fileKind: "documentation" },
  "contributing": { language: "text", fileKind: "documentation" },
  "readme": { language: "text", fileKind: "documentation" },
  "history": { language: "text", fileKind: "documentation" },
  "history.md": { language: "markdown", fileKind: "documentation" },
  "history.txt": { language: "text", fileKind: "documentation" },
  "tap-parallel-not-ok": { language: "text", fileKind: "configuration" },
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
  ".svg": "markup", ".drawio": "data", "._js_": "data", "._ts_": "data",
  ".png": "binary", ".jpg": "binary", ".jpeg": "binary", ".gif": "binary", ".ico": "binary", ".webp": "binary", ".pdf": "binary",
  ".wasm": "binary", ".lock": "data", ".lockb": "binary", ".map": "data",
  ".crt": "data", ".key": "data", ".pem": "data", ".cert": "data",
};

export interface FileScannerOptions {
  readonly readdir?: typeof readdir;
  readonly stat?: typeof stat;
  readonly readFile?: (path: string, encoding: "utf8") => Promise<string>;
}

/** Minified bundles are build output even when committed: listed as generated, not analyzed (BA-15). */
const MINIFIED = /\.min\.(?:js|mjs|cjs)$/i;

export class FileScanner {
  private readonly readdirFn: typeof readdir;
  private readonly statFn: typeof stat;
  private readonly readFileFn: (path: string, encoding: "utf8") => Promise<string>;

  public constructor(options: FileScannerOptions = {}) {
    this.readdirFn = options.readdir ?? readdir;
    this.statFn = options.stat ?? stat;
    this.readFileFn = options.readFile ?? ((path, encoding) => readFile(path, encoding));
  }

  public async scan(projectPath: string): Promise<FileScanResult> {
    const resolvedProjectPath = resolve(projectPath);
    const projectStats = await this.getProjectStats(resolvedProjectPath);

    if (projectStats === undefined || !projectStats.isDirectory()) {
      throw new LegacyExodusError({
        code: "DISCOVERY_PATH_INVALID",
        message: "Discovery path must be a directory.",
        metadata: { projectPath: resolvedProjectPath },
      });
    }

    const files: FileArtifact[] = [];
    const enumerationFailures: DiscoveryEnumerationFailure[] = [];
    const excludedPaths: ExcludedPath[] = [];
    // A root .legacyexodusignore (gitignore syntax) excludes more than git does; it can be overridden by nothing below.
    const configured = await this.readIgnoreFile(resolve(resolvedProjectPath, ".legacyexodusignore"));
    const rules = configured === undefined ? IgnoreRules.none : IgnoreRules.none.withFile("", configured, "legacyexodusignore");

    await this.scanDirectory(resolvedProjectPath, resolvedProjectPath, files, enumerationFailures, excludedPaths, rules);

    enumerationFailures.sort((left, right) =>
      compareCodePoints(left.path, right.path) || compareCodePoints(left.kind, right.kind) || compareCodePoints(left.code, right.code),
    );

    return Object.freeze({
      files: Object.freeze(files),
      enumerationFailures: Object.freeze(enumerationFailures),
      excludedPaths: Object.freeze(excludedPaths),
    });
  }

  private async scanDirectory(
    projectPath: string,
    currentPath: string,
    files: FileArtifact[],
    failures: DiscoveryEnumerationFailure[],
    excludedPaths: ExcludedPath[],
    inherited: IgnoreRules,
  ): Promise<void> {
    let entries: Dirent[];
    try {
      entries = (await this.readdirFn(currentPath, { withFileTypes: true })) as unknown as Dirent[];
    } catch (error: unknown) {
      const relPath = relative(projectPath, currentPath).split(sep).join("/");
      failures.push(Object.freeze({
        path: relPath === "" ? "." : relPath,
        kind: "directory-read",
        code: getErrorCode(error),
      }));
      return;
    }

    const directory = relative(projectPath, currentPath).split(sep).join("/");
    // A directory's own .gitignore applies to everything below it (git's semantics).
    const gitignore = entries.some((entry) => entry.name === ".gitignore" && entry.isFile())
      ? await this.readIgnoreFile(resolve(currentPath, ".gitignore"))
      : undefined;
    const rules = gitignore === undefined ? inherited : inherited.withFile(directory, gitignore, "gitignore");

    for (const entry of entries.sort((left, right) => compareCodePoints(left.name, right.name))) {
      const entryPath = resolve(currentPath, entry.name);
      const entryRelative = directory === "" ? entry.name : `${directory}/${entry.name}`;

      // Intentional traversal policy: Symbolic links are skipped to protect against
      // traversal cycles, duplicate source analysis, and escaping repository boundaries.
      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) continue;
        const reason = rules.ignoredBy(entryRelative, true);
        if (reason !== undefined) {
          excludedPaths.push(Object.freeze({ path: entryRelative, kind: "directory", reason }));
          continue;
        }
        await this.scanDirectory(projectPath, entryPath, files, failures, excludedPaths, rules);
        continue;
      }

      if (entry.isFile()) {
        const reason = rules.ignoredBy(entryRelative, false);
        if (reason !== undefined) {
          excludedPaths.push(Object.freeze({ path: entryRelative, kind: "file", reason }));
          continue;
        }
        try {
          files.push(await this.createFileArtifact(projectPath, entryPath));
        } catch (error: unknown) {
          const relPath = relative(projectPath, entryPath).split(sep).join("/");
          failures.push(Object.freeze({
            path: relPath,
            kind: "entry-stat",
            code: getErrorCode(error),
          }));
        }
      }
    }
  }

  private async createFileArtifact(projectPath: string, filePath: string): Promise<FileArtifact> {
    const fileStats = await this.statFn(filePath);
    const path = relative(projectPath, filePath).split(sep).join("/");
    const extensionIndex = path.lastIndexOf(".");
    const extension = extensionIndex < 0 ? "" : path.slice(extensionIndex).toLowerCase();

    const known = knownFiles[path.split("/").at(-1)?.toLowerCase() ?? ""];
    return Object.freeze({
      id: createHash("sha256").update(path).digest("hex"),
      path,
      language: known?.language ?? languageByExtension[extension] ?? "unknown",
      fileKind: MINIFIED.test(path) ? "generated" : known?.fileKind ?? fileKindByExtension[extension] ?? "unknown",
      size: fileStats.size,
    });
  }

  private async readIgnoreFile(path: string): Promise<string | undefined> {
    try {
      return await this.readFileFn(path, "utf8");
    } catch {
      return undefined;
    }
  }

  private async getProjectStats(projectPath: string): Promise<Awaited<ReturnType<typeof stat>>> {
    try {
      return await this.statFn(projectPath);
    } catch {
      throw new LegacyExodusError({
        code: "DISCOVERY_PATH_NOT_FOUND",
        message: "Discovery path does not exist.",
        metadata: { projectPath },
      });
    }
  }
}

function getErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { readonly code: unknown }).code;
    if (typeof code === "string" && code.length > 0) {
      return code;
    }
  }
  if (error instanceof Error && error.name && error.name !== "Error") {
    return error.name;
  }
  return "ENUMERATION_FAILURE";
}
