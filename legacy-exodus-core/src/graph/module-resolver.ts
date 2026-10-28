import { dirname, posix } from "node:path";

import type { FileArtifact } from "@contracts/discovery";

export interface ResolvedImport {
  readonly importerPath: string;
  readonly moduleSpecifier: string;
  readonly resolvedPath: string | null;
}

/**
 * Parsed tsconfig alias configuration supplied by the composition boundary.
 *
 * Every path is project-root-relative POSIX. `paths` targets are relative to `baseUrl` when one is
 * set and to the project root otherwise; their listed order is the order they are tried in.
 */
export interface ModuleResolutionOptions {
  readonly baseUrl?: string;
  readonly paths?: Readonly<Record<string, readonly string[]>>;
}

export type KnownPathLookup = readonly FileArtifact[] | ReadonlySet<string>;

/** Canonicalizes a repository file path or specifier to normalized POSIX format. */
export function canonicalizePath(path: string): string {
  const normalized = posix.normalize(path.replaceAll("\\", "/"));
  if (/^[a-zA-Z]:/.test(normalized)) {
    return normalized.charAt(0).toLowerCase() + normalized.slice(1);
  }
  if (/^\/[a-zA-Z]:/.test(normalized)) {
    return `/${normalized.charAt(1).toLowerCase()}${normalized.slice(2)}`;
  }
  return normalized;
}

export class ModuleResolver {
  private readonly fileArtifactCache = new WeakMap<readonly FileArtifact[], ReadonlySet<string>>();
  private readonly setCache = new WeakMap<ReadonlySet<string>, ReadonlySet<string>>();

  public constructor(private readonly options: ModuleResolutionOptions = {}) {}

  public resolve(
    importerPath: string,
    moduleSpecifier: string,
    files: KnownPathLookup,
  ): ResolvedImport {
    const knownPaths = this.getKnownPathSet(files);
    const normalizedImporter = canonicalizePath(importerPath);
    const rawNormalizedSpecifier = moduleSpecifier.replaceAll("\\", "/");
    const importerIsTypeScript = TYPESCRIPT_IMPORTER.test(normalizedImporter);

    if (!rawNormalizedSpecifier.startsWith(".")) {
      const resolvedPath = this.resolveNonRelative(rawNormalizedSpecifier, knownPaths, importerIsTypeScript);
      return Object.freeze({ importerPath, moduleSpecifier, resolvedPath });
    }

    const basePath = canonicalizePath(posix.join(dirname(normalizedImporter), rawNormalizedSpecifier));
    return Object.freeze({
      importerPath,
      moduleSpecifier,
      resolvedPath: firstKnown(candidatesFor(basePath, importerIsTypeScript), knownPaths),
    });
  }

  private getKnownPathSet(files: KnownPathLookup): ReadonlySet<string> {
    if (Array.isArray(files)) {
      const cached = this.fileArtifactCache.get(files);
      if (cached !== undefined) {
        return cached;
      }
      const pathSet = new Set(files.map((file) => canonicalizePath(file.path)));
      this.fileArtifactCache.set(files, pathSet);
      return pathSet;
    }

    const setFiles = files as ReadonlySet<string>;
    const cached = this.setCache.get(setFiles);
    if (cached !== undefined) {
      return cached;
    }
    const normalizedSet = new Set<string>(Array.from(setFiles, (p) => canonicalizePath(p)));
    this.setCache.set(setFiles, normalizedSet);
    return normalizedSet;
  }

  /**
   * Non-relative specifiers follow TypeScript: `paths` first, through the single best-matching
   * pattern, then `baseUrl`. Anything else (packages, built-ins, URLs) stays unresolved.
   */
  private resolveNonRelative(
    specifier: string,
    knownPaths: ReadonlySet<string>,
    importerIsTypeScript: boolean,
  ): string | null {
    if (specifier.length === 0) return null;
    const baseUrl = canonicalizePath(this.options.baseUrl ?? "");

    const best = selectPathsPattern(this.options.paths, specifier);
    if (best !== undefined) {
      for (const target of best.targets) {
        const normalizedTarget = target.replaceAll("\\", "/");
        if (isAbsoluteLike(normalizedTarget)) continue;
        const star = normalizedTarget.indexOf("*");
        if (star >= 0 && normalizedTarget.indexOf("*", star + 1) >= 0) continue;
        const substituted = star < 0 || best.captured === undefined
          ? normalizedTarget
          : normalizedTarget.slice(0, star) + best.captured + normalizedTarget.slice(star + 1);
        const resolved = firstKnown(candidatesFor(canonicalizePath(posix.join(baseUrl, substituted)), importerIsTypeScript), knownPaths);
        if (resolved !== null) return resolved;
      }
    }

    if (this.options.baseUrl !== undefined && !NOT_BASE_URL_RELATIVE.test(specifier)) {
      return firstKnown(candidatesFor(canonicalizePath(posix.join(baseUrl, specifier)), importerIsTypeScript), knownPaths);
    }
    return null;
  }
}

/** Importers whose own language is TypeScript; they prefer TypeScript sources for `.js` specifiers. */
const TYPESCRIPT_IMPORTER = /\.(?:ts|tsx|mts|cts)$/i;

/** Absolute paths, drive letters and URL schemes (`node:fs`, `https://…`) are not relative to a baseUrl. */
const NOT_BASE_URL_RELATIVE = /^(?:\/|[a-zA-Z][a-zA-Z0-9+.-]*:)/;

function isAbsoluteLike(path: string): boolean {
  return path.startsWith("/") || /^[a-zA-Z]:/.test(path);
}

interface PathsMatch {
  readonly targets: readonly string[];
  /** The text the `*` of a wildcard pattern matched; undefined for an exact pattern. */
  readonly captured: string | undefined;
}

/**
 * TypeScript's `paths` precedence: an exact pattern wins; otherwise the wildcard pattern with the
 * longest prefix before `*` wins, earlier declarations winning ties. Only that pattern is used.
 */
function selectPathsPattern(
  paths: Readonly<Record<string, readonly string[]>> | undefined,
  specifier: string,
): PathsMatch | undefined {
  if (paths === undefined) return undefined;
  let best: PathsMatch | undefined;
  let bestPrefixLength = -1;
  for (const [pattern, targets] of Object.entries(paths)) {
    const normalizedPattern = pattern.replaceAll("\\", "/");
    const star = normalizedPattern.indexOf("*");
    if (star < 0) {
      if (normalizedPattern === specifier) return { targets, captured: undefined };
      continue;
    }
    if (normalizedPattern.indexOf("*", star + 1) >= 0) continue;
    const prefix = normalizedPattern.slice(0, star);
    const suffix = normalizedPattern.slice(star + 1);
    if (specifier.length < prefix.length + suffix.length || !specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
    if (prefix.length > bestPrefixLength) {
      best = { targets, captured: specifier.slice(prefix.length, specifier.length - suffix.length) };
      bestPrefixLength = prefix.length;
    }
  }
  return best;
}

function firstKnown(candidates: readonly string[], knownPaths: ReadonlySet<string>): string | null {
  return candidates.find((candidate) => knownPaths.has(candidate)) ?? null;
}

/** TypeScript source files that a JavaScript-extension specifier stands for, in TypeScript's order. */
const TYPESCRIPT_SOURCE_SUBSTITUTES: ReadonlyArray<readonly [string, readonly string[]]> = [
  [".js", [".ts", ".tsx", ".d.ts"]],
  [".jsx", [".tsx"]],
  [".mjs", [".mts", ".d.mts"]],
  [".cjs", [".cts", ".d.cts"]],
];

function typeScriptSubstitutes(clean: string): readonly string[] {
  for (const [extension, replacements] of TYPESCRIPT_SOURCE_SUBSTITUTES) {
    if (!clean.endsWith(extension)) continue;
    const stem = clean.slice(0, clean.length - extension.length);
    if (stem.length === 0 || stem.endsWith("/")) return [];
    return replacements.map((replacement) => `${stem}${replacement}`);
  }
  return [];
}

/**
 * Extensions an extensionless module path can name, most preferred first. TypeScript tries its own
 * sources before JavaScript files, so a TypeScript importer does too; a JavaScript importer keeps the
 * established order, in which `.js` comes before `.ts`.
 */
const FILE_EXTENSIONS_FOR_TYPESCRIPT = [".ts", ".tsx", ".d.ts", ".mts", ".cts", ".d.mts", ".d.cts", ".js", ".jsx", ".mjs", ".cjs"] as const;
const FILE_EXTENSIONS_FOR_JAVASCRIPT = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts", ".d.ts", ".d.mts", ".d.cts"] as const;
const INDEX_FILES_FOR_TYPESCRIPT = ["index.ts", "index.tsx", "index.d.ts", "index.js", "index.jsx", "index.mjs", "index.cjs"] as const;
const INDEX_FILES_FOR_JAVASCRIPT = ["index.js", "index.jsx", "index.ts", "index.tsx", "index.mjs", "index.cjs", "index.d.ts"] as const;

/**
 * Files a module path can name, most preferred first: the path itself, then the path with each
 * extension, then its directory index files; files always come before directory indexes. A
 * specifier written with a JavaScript extension (`./a.js`, which TypeScript's NodeNext and Bundler
 * modes require for `a.ts`) also names the TypeScript source: a TypeScript importer tries those
 * sources before the literal file, a JavaScript importer after it.
 */
function candidatesFor(basePath: string, importerIsTypeScript: boolean): readonly string[] {
  const clean = canonicalizePath(basePath);
  const extensionless = [
    clean,
    ...(importerIsTypeScript ? FILE_EXTENSIONS_FOR_TYPESCRIPT : FILE_EXTENSIONS_FOR_JAVASCRIPT).map((extension) => `${clean}${extension}`),
    ...(importerIsTypeScript ? INDEX_FILES_FOR_TYPESCRIPT : INDEX_FILES_FOR_JAVASCRIPT).map((index) => posix.join(clean, index)),
  ];
  const substitutes = typeScriptSubstitutes(clean);
  if (substitutes.length === 0) return Object.freeze(extensionless);
  return Object.freeze(importerIsTypeScript
    ? [...substitutes, ...extensionless]
    : [clean, ...substitutes, ...extensionless.slice(1)]);
}
