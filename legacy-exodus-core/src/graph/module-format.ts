import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";

import type { FileArtifact } from "@contracts/discovery";

import { canonicalizePath } from "./module-resolver";
import { parseJsonc } from "./tsconfig-loader";

/** TypeScript `module` settings whose output format follows the file extension and the nearest `package.json` `type`. */
const NODE_MODULE_SETTINGS = new Set(["node16", "node18", "node20", "nodenext"]);
/** At most this many `extends` hops are followed when looking for `module`. */
const MAX_EXTENDS = 8;

/**
 * TypeScript files the compiler turns into CommonJS (B2), by project-relative POSIX path. Such a file may use
 * `import` syntax and still call `require`, which is then the module wrapper's own function. A `.ts`, `.tsx`
 * or `.cts` file counts when the nearest `tsconfig.json` above it (inside the project) sets `module` to
 * `commonjs`, or to a Node setting (`node16`, `node18`, `node20`, `nodenext`) where the file is `.cts` or the
 * nearest `package.json` has no `"type": "module"`. `module` is looked up through relative `extends` only; a
 * config that leaves it unset, or inherits it from a package, decides nothing. `.mts` and `.d.ts` files never
 * count. Assumption: the nearest config is the one that compiles the file (its `include` is not checked).
 */
export async function loadCompiledCommonJsFiles(projectPath: string, files: readonly FileArtifact[]): Promise<ReadonlySet<string>> {
  const paths = files.map((file) => canonicalizePath(file.path));
  const known = new Set(paths);
  const moduleByConfig = new Map<string, string | undefined>();
  const typeByManifest = new Map<string, string | undefined>();
  const nearest = (directory: string, name: string): string | undefined => {
    for (let current = directory; ; current = posix.dirname(current)) {
      const candidate = current === "." ? name : `${current}/${name}`;
      if (known.has(candidate)) return candidate;
      if (current === "." || current === "") return undefined;
    }
  };
  const result = new Set<string>();
  for (const path of paths) {
    if (!/\.(?:c?ts|tsx)$/i.test(path) || /\.d\.[cm]?ts$/i.test(path)) continue;
    const directory = posix.dirname(path);
    const config = nearest(directory, "tsconfig.json");
    if (config === undefined) continue;
    if (!moduleByConfig.has(config)) moduleByConfig.set(config, await moduleSetting(projectPath, config, known));
    const setting = moduleByConfig.get(config);
    if (setting === "commonjs") { result.add(path); continue; }
    if (setting === undefined || !NODE_MODULE_SETTINGS.has(setting)) continue;
    if (/\.cts$/i.test(path)) { result.add(path); continue; }
    const manifest = nearest(directory, "package.json");
    if (manifest === undefined) { result.add(path); continue; }
    if (!typeByManifest.has(manifest)) typeByManifest.set(manifest, await packageType(projectPath, manifest));
    if (typeByManifest.get(manifest) !== "module") result.add(path);
  }
  return result;
}

/** The lower-cased `compilerOptions.module` of a config, following relative `extends` (the last entry wins). */
async function moduleSetting(projectPath: string, config: string, known: ReadonlySet<string>, depth = 0): Promise<string | undefined> {
  const root = await readJsonc(join(projectPath, config));
  if (root === undefined) return undefined;
  const options = root["compilerOptions"];
  const own = typeof options === "object" && options !== null ? (options as Record<string, unknown>)["module"] : undefined;
  if (typeof own === "string") return own.toLowerCase();
  if (depth >= MAX_EXTENDS) return undefined;
  const extended = root["extends"];
  const entries = typeof extended === "string" ? [extended] : Array.isArray(extended) ? extended : [];
  for (const entry of [...entries].reverse()) {
    if (typeof entry !== "string" || !entry.startsWith(".")) continue;
    const target = canonicalizePath(posix.join(posix.dirname(config), entry));
    const file = known.has(target) ? target : known.has(`${target}.json`) ? `${target}.json` : undefined;
    if (file === undefined) continue;
    const inherited = await moduleSetting(projectPath, file, known, depth + 1);
    if (inherited !== undefined) return inherited;
  }
  return undefined;
}

async function packageType(projectPath: string, manifest: string): Promise<string | undefined> {
  const value = (await readJsonc(join(projectPath, manifest)))?.["type"];
  return typeof value === "string" ? value : undefined;
}

async function readJsonc(path: string): Promise<Record<string, unknown> | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  const parsed = parseJsonc(text);
  return parsed.ok && typeof parsed.value === "object" && parsed.value !== null && !Array.isArray(parsed.value) ? parsed.value as Record<string, unknown> : undefined;
}
