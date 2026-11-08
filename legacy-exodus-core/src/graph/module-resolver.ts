import { dirname, posix } from "node:path";

import type { FileArtifact } from "@contracts/discovery";
import { immutable } from "@shared/immutability";

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
  /** Workspace packages by name (S3, see workspace-loader.ts). */
  readonly packages?: Readonly<Record<string, WorkspacePackage>>;
}

/** A workspace package: its project-relative POSIX root and the manifest fields naming its entry points. */
export interface WorkspacePackage {
  readonly root: string;
  readonly exports?: unknown;
  readonly source?: string;
  readonly module?: string;
  readonly main?: string;
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
      return immutable({ importerPath, moduleSpecifier, resolvedPath });
    }

    const basePath = canonicalizePath(posix.join(dirname(normalizedImporter), rawNormalizedSpecifier));
    return immutable({
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
   * pattern, then `baseUrl`, then packages, which here means workspace packages only. Anything else
   * (installed packages, built-ins, URLs) stays unresolved.
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
      const viaBaseUrl = firstKnown(candidatesFor(canonicalizePath(posix.join(baseUrl, specifier)), importerIsTypeScript), knownPaths);
      if (viaBaseUrl !== null) return viaBaseUrl;
    }
    return this.resolveWorkspacePackage(specifier, knownPaths, importerIsTypeScript);
  }

  /**
   * `name` or `name/subpath` of a workspace package. With an `exports` map the subpath must be
   * exported, and a conditional target is tried in SOURCE_FIRST_CONDITIONS order; without one, the
   * root is `source`, `module`, then `main`, then the package's index. Only files that exist in the
   * project and lie inside the package root are accepted: an export to build output that is not in
   * the repository stays unresolved.
   */
  private resolveWorkspacePackage(specifier: string, knownPaths: ReadonlySet<string>, importerIsTypeScript: boolean): string | null {
    const packages = this.options.packages;
    if (packages === undefined) return null;
    const segments = specifier.split("/");
    const scoped = specifier.startsWith("@");
    if (scoped && segments.length < 2) return null;
    const name = scoped ? `${segments[0]}/${segments[1]}` : segments[0]!;
    const workspacePackage = Object.hasOwn(packages, name) ? packages[name] : undefined;
    if (workspacePackage === undefined) return null;
    const root = canonicalizePath(workspacePackage.root);
    const subpath = specifier === name ? "." : `./${specifier.slice(name.length + 1)}`;
    const located = (target: string): string | null => {
      const relative = target.startsWith("./") || target.startsWith("../") ? target : `./${target}`;
      const path = canonicalizePath(posix.join(root, relative));
      if (path !== root && !path.startsWith(`${root}/`)) return null;
      return firstKnown(candidatesFor(path, importerIsTypeScript), knownPaths);
    };
    // A target in build output that is not in the repository (`dist/x.js`, `build/x.cjs`) is compiled from the
    // package's own `src/x`; analysis wants that source. Only an existing file is accepted.
    const file = (target: string): string | null => {
      const direct = located(target);
      if (direct !== null) return direct;
      const built = /^(?:\.\/)?(?:dist|build|lib|es|esm|cjs|out)\/(.+?)(?:\.(?:umd|cjs|esm|es|min))*\.(?:d\.ts|[cm]?js)$/.exec(target);
      return built === null ? null : located(`./src/${built[1]}`);
    };

    if (workspacePackage.exports !== undefined && workspacePackage.exports !== null) {
      const match = matchExports(workspacePackage.exports, subpath);
      if (match === undefined) return null;
      // A root export only to a bundle (`dist/name.umd.js`) has no same-named source; the package's entry is src/index.
      return resolveExportTarget(match.target, match.captured, file) ?? (subpath === "." && match.target !== null ? located("./src/index") : null);
    }
    if (subpath !== ".") return file(subpath);
    for (const field of [workspacePackage.source, workspacePackage.module, workspacePackage.main]) {
      if (typeof field !== "string" || field.length === 0) continue;
      const resolved = file(field);
      if (resolved !== null) return resolved;
    }
    return located("./index") ?? located("./src/index");
  }
}

/** Conditions tried for a conditional export: the source first, since analysis wants code, not build output. */
const SOURCE_FIRST_CONDITIONS = ["source", "import", "require", "node", "default", "types"] as const;

/** The target an `exports` field maps `subpath` to: an exact key, else the wildcard key with the longest prefix. */
function matchExports(exports: unknown, subpath: string): { readonly target: unknown; readonly captured: string | undefined } | undefined {
  const isSubpathMap = typeof exports === "object" && exports !== null && !Array.isArray(exports)
    && Object.keys(exports).some((key) => key.startsWith("."));
  const map = isSubpathMap ? exports as Record<string, unknown> : { ".": exports };
  if (Object.hasOwn(map, subpath)) return { target: map[subpath], captured: undefined };
  let best: { target: unknown; captured: string } | undefined;
  let bestPrefix = -1;
  for (const [key, target] of Object.entries(map)) {
    const star = key.indexOf("*");
    if (star < 0 || key.indexOf("*", star + 1) >= 0) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (subpath.length < prefix.length + suffix.length || !subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
    if (prefix.length > bestPrefix) {
      best = { target, captured: subpath.slice(prefix.length, subpath.length - suffix.length) };
      bestPrefix = prefix.length;
    }
  }
  return best;
}

function resolveExportTarget(target: unknown, captured: string | undefined, file: (target: string) => string | null): string | null {
  if (typeof target === "string") {
    if (!target.startsWith("./")) return null;
    return file(captured === undefined ? target : target.replaceAll("*", captured));
  }
  if (Array.isArray(target)) {
    for (const candidate of target) {
      const resolved = resolveExportTarget(candidate, captured, file);
      if (resolved !== null) return resolved;
    }
    return null;
  }
  if (typeof target !== "object" || target === null) return null;
  const conditions = target as Record<string, unknown>;
  for (const condition of SOURCE_FIRST_CONDITIONS) {
    if (!Object.hasOwn(conditions, condition)) continue;
    const resolved = resolveExportTarget(conditions[condition], captured, file);
    if (resolved !== null) return resolved;
  }
  return null;
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
  if (substitutes.length === 0) return immutable(extensionless);
  return immutable(importerIsTypeScript
    ? [...substitutes, ...extensionless]
    : [clean, ...substitutes, ...extensionless.slice(1)]);
}
