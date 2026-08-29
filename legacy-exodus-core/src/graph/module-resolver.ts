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

export class ModuleResolver {
  private readonly pathSetCache = new WeakMap<readonly FileArtifact[], ReadonlySet<string>>();

  public constructor(private readonly options: ModuleResolutionOptions = {}) {}

  public resolve(
    importerPath: string,
    moduleSpecifier: string,
    files: KnownPathLookup,
  ): ResolvedImport {
    const knownPaths = this.getKnownPathSet(files);
    const normalizedImporter = importerPath.replaceAll("\\", "/");
    const normalizedSpecifier = moduleSpecifier.replaceAll("\\", "/");

    if (!normalizedSpecifier.startsWith(".")) {
      const aliased = this.resolveAlias(normalizedSpecifier, knownPaths);
      if (aliased !== null) {
        return Object.freeze({ importerPath, moduleSpecifier, resolvedPath: aliased });
      }
      return Object.freeze({ importerPath, moduleSpecifier, resolvedPath: null });
    }

    const basePath = posix.normalize(posix.join(dirname(normalizedImporter), normalizedSpecifier));
    const candidates = candidatesFor(basePath);
    const resolvedPath = candidates.find((candidate) => knownPaths.has(posix.normalize(candidate.replaceAll("\\", "/")))) ?? null;

    return Object.freeze({
      importerPath,
      moduleSpecifier,
      resolvedPath: resolvedPath !== null ? posix.normalize(resolvedPath.replaceAll("\\", "/")) : null,
    });
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
    const pathSet = new Set(files.map((file) => posix.normalize(file.path.replaceAll("\\", "/"))));
    this.pathSetCache.set(files, pathSet);
    return pathSet;
  }

  private resolveAlias(moduleSpecifier: string, knownPaths: ReadonlySet<string>): string | null {
    const normalizedSpecifier = moduleSpecifier.replaceAll("\\", "/");
    const normalizedBaseUrl = (this.options.baseUrl ?? "").replaceAll("\\", "/");
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
        const candidate = posix.normalize(posix.join(normalizedBaseUrl, normalizedTarget.replace("*", match)));
        for (const resolved of candidatesFor(candidate)) {
          const normalizedResolved = posix.normalize(resolved.replaceAll("\\", "/"));
          if (knownPaths.has(normalizedResolved)) return normalizedResolved;
        }
      }
    }
    return null;
  }
}

function candidatesFor(basePath: string): readonly string[] {
  const clean = posix.normalize(basePath.replaceAll("\\", "/"));
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
