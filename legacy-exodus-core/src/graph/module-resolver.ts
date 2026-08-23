import { dirname, normalize, posix } from "node:path";

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

export class ModuleResolver {
  private readonly pathSetCache = new WeakMap<readonly FileArtifact[], ReadonlySet<string>>();

  public constructor(private readonly options: ModuleResolutionOptions = {}) {}

  public resolve(
    importerPath: string,
    moduleSpecifier: string,
    files: KnownPathLookup,
  ): ResolvedImport {
    const knownPaths = this.getKnownPathSet(files);

    if (!moduleSpecifier.startsWith(".")) {
      const aliased = this.resolveAlias(moduleSpecifier, knownPaths);
      if (aliased !== null) {
        return Object.freeze({ importerPath, moduleSpecifier, resolvedPath: aliased });
      }
      return Object.freeze({ importerPath, moduleSpecifier, resolvedPath: null });
    }

    const basePath = posix.normalize(posix.join(dirname(importerPath).replaceAll("\\", "/"), moduleSpecifier));
    const candidates = candidatesFor(basePath);
    const resolvedPath = candidates.find((candidate) => knownPaths.has(normalize(candidate).replaceAll("\\", "/"))) ?? null;

    return Object.freeze({ importerPath, moduleSpecifier, resolvedPath });
  }

  private getKnownPathSet(files: KnownPathLookup): ReadonlySet<string> {
    if (files instanceof Set) {
      return files;
    }
    if (!Array.isArray(files)) {
      return files as ReadonlySet<string>;
    }
    const cached = this.pathSetCache.get(files);
    if (cached !== undefined) {
      return cached;
    }
    const pathSet = new Set(files.map((file) => file.path));
    this.pathSetCache.set(files, pathSet);
    return pathSet;
  }

  private resolveAlias(moduleSpecifier: string, knownPaths: ReadonlySet<string>): string | null {
    const aliases = Object.entries(this.options.paths ?? {}).sort(([left], [right]) => left.localeCompare(right));
    for (const [pattern, targets] of aliases) {
      const wildcard = pattern.indexOf("*");
      const match = wildcard < 0
        ? pattern === moduleSpecifier ? "" : undefined
        : moduleSpecifier.startsWith(pattern.slice(0, wildcard)) && moduleSpecifier.endsWith(pattern.slice(wildcard + 1))
          ? moduleSpecifier.slice(wildcard, moduleSpecifier.length - pattern.slice(wildcard + 1).length)
          : undefined;
      if (match === undefined) continue;
      for (const target of [...targets].sort()) {
        const candidate = posix.normalize(posix.join(this.options.baseUrl ?? "", target.replace("*", match)));
        for (const resolved of candidatesFor(candidate)) {
          if (knownPaths.has(resolved)) return resolved;
        }
      }
    }
    return null;
  }
}

function candidatesFor(basePath: string): readonly string[] {
  return Object.freeze([
    basePath,
    `${basePath}.js`,
    `${basePath}.jsx`,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.mjs`,
    `${basePath}.cjs`,
    `${basePath}/index.js`,
    `${basePath}/index.jsx`,
    `${basePath}/index.ts`,
    `${basePath}/index.tsx`,
    `${basePath}/index.mjs`,
    `${basePath}/index.cjs`,
  ]);
}
