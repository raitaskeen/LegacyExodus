import { dirname, normalize, posix } from "node:path";

import type { FileArtifact } from "@contracts/discovery";

export interface ResolvedImport {
  readonly importerPath: string;
  readonly moduleSpecifier: string;
  readonly resolvedPath: string | null;
}

export class ModuleResolver {
  public resolve(importerPath: string, moduleSpecifier: string, files: readonly FileArtifact[]): ResolvedImport {
    if (!moduleSpecifier.startsWith(".")) {
      return Object.freeze({ importerPath, moduleSpecifier, resolvedPath: null });
    }

    const knownPaths = new Set(files.map((file) => file.path));
    const basePath = posix.normalize(posix.join(dirname(importerPath).replaceAll("\\", "/"), moduleSpecifier));
    const candidates = [
      basePath,
      `${basePath}.js`,
      `${basePath}.jsx`,
      `${basePath}.ts`,
      `${basePath}.tsx`,
      `${basePath}.mjs`,
      `${basePath}.cjs`,
      `${basePath}/index.js`,
      `${basePath}/index.ts`,
      `${basePath}/index.mjs`,
      `${basePath}/index.cjs`,
    ];
    const resolvedPath = candidates.find((candidate) => knownPaths.has(normalize(candidate).replaceAll("\\", "/"))) ?? null;

    return Object.freeze({ importerPath, moduleSpecifier, resolvedPath });
  }
}
