import { dirname, posix } from "node:path";

import type { FileArtifact } from "@contracts/discovery";

export interface ResolvedImport {
  readonly importerPath: string;
  readonly moduleSpecifier: string;
  readonly resolvedPath: string | null;
}

/** Parsed tsconfig alias configuration supplied by the composition boundary. */
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

    if (!rawNormalizedSpecifier.startsWith(".")) {
      const aliased = this.resolveAlias(rawNormalizedSpecifier, knownPaths);
      if (aliased !== null) {
        return Object.freeze({ importerPath, moduleSpecifier, resolvedPath: aliased });
      }
      return Object.freeze({ importerPath, moduleSpecifier, resolvedPath: null });
    }

    const basePath = canonicalizePath(posix.join(dirname(normalizedImporter), rawNormalizedSpecifier));
    const candidates = candidatesFor(basePath);
    const resolvedPath = candidates.find((candidate) => knownPaths.has(candidate)) ?? null;

    return Object.freeze({
      importerPath,
      moduleSpecifier,
      resolvedPath,
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

  private resolveAlias(moduleSpecifier: string, knownPaths: ReadonlySet<string>): string | null {
    const normalizedSpecifier = moduleSpecifier.replaceAll("\\", "/");
    const normalizedBaseUrl = canonicalizePath(this.options.baseUrl ?? "");
    const aliases = Object.entries(this.options.paths ?? {}).sort(([left], [right]) => left.localeCompare(right));
    for (const [pattern, targets] of aliases) {
      const normalizedPattern = pattern.replaceAll("\\", "/");
      const wildcard = normalizedPattern.indexOf("*");
      const match = wildcard < 0
        ? normalizedPattern === normalizedSpecifier ? "" : undefined
        : normalizedSpecifier.startsWith(normalizedPattern.slice(0, wildcard)) && normalizedSpecifier.endsWith(normalizedPattern.slice(wildcard + 1))
          ? normalizedSpecifier.slice(wildcard, normalizedSpecifier.length - normalizedPattern.slice(wildcard + 1).length)
          : undefined;
      if (match === undefined) continue;
      for (const target of [...targets].sort()) {
        const normalizedTarget = target.replaceAll("\\", "/");
        const candidate = canonicalizePath(posix.join(normalizedBaseUrl, normalizedTarget.replace("*", match)));
        for (const resolved of candidatesFor(candidate)) {
          if (knownPaths.has(resolved)) return resolved;
        }
      }
    }
    return null;
  }
}

function candidatesFor(basePath: string): readonly string[] {
  const clean = canonicalizePath(basePath);
  return Object.freeze([
    clean,
    `${clean}.js`,
    `${clean}.jsx`,
    `${clean}.ts`,
    `${clean}.tsx`,
    `${clean}.mjs`,
    `${clean}.cjs`,
    posix.join(clean, "index.js"),
    posix.join(clean, "index.jsx"),
    posix.join(clean, "index.ts"),
    posix.join(clean, "index.tsx"),
    posix.join(clean, "index.mjs"),
    posix.join(clean, "index.cjs"),
  ]);
}
