import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";

import type { FileArtifact } from "@contracts/discovery";

import { canonicalizePath, type PackageScope, type WorkspacePackage } from "./module-resolver";
import { immutable } from "@shared/immutability";

/**
 * The `main` of every `package.json` discovery found, by its project-relative POSIX directory (`.` for the
 * root). Node loads a required directory through its `main` before its index, so `require("..")` in a
 * package's tests is the package. Only manifests already in the inventory are read; unreadable ones and
 * those without a string `main` are skipped.
 */
export async function loadDirectoryMains(projectPath: string, files: readonly FileArtifact[]): Promise<Readonly<Record<string, string>>> {
  const mains: Record<string, string> = {};
  const manifests = files.map((file) => canonicalizePath(file.path)).filter((path) => posix.basename(path) === "package.json").sort();
  for (const path of manifests) {
    const manifest = await readJson(join(projectPath, path));
    if (typeof manifest?.main === "string" && manifest.main.length > 0) mains[canonicalizePath(posix.dirname(path))] = manifest.main;
  }
  return immutable(mains);
}

/**
 * Every `package.json` discovery found, by its project-relative POSIX directory (`.` for the root), with the fields
 * Node uses to load a package from inside itself (XB-02): `name` and `exports` for a self-reference
 * (`require("pkg/sub")` within pkg), `imports` for `#` specifiers. Manifests with none of them, or unreadable, are
 * skipped.
 */
export async function loadPackageScopes(projectPath: string, files: readonly FileArtifact[]): Promise<Readonly<Record<string, PackageScope>>> {
  const scopes: Record<string, PackageScope> = {};
  const manifests = files.map((file) => canonicalizePath(file.path)).filter((path) => posix.basename(path) === "package.json").sort();
  for (const path of manifests) {
    const manifest = await readJson(join(projectPath, path));
    if (manifest === undefined) continue;
    const scope: PackageScope = {
      ...(typeof manifest.name === "string" && manifest.name.length > 0 ? { name: manifest.name } : {}),
      ...(manifest.exports === undefined || manifest.exports === null ? {} : { exports: manifest.exports }),
      ...(typeof manifest.imports === "object" && manifest.imports !== null && !Array.isArray(manifest.imports) ? { imports: manifest.imports } : {}),
    };
    // Recorded even when empty: the nearest manifest decides, so one without `imports` hides an outer one's.
    scopes[canonicalizePath(posix.dirname(path))] = scope;
  }
  return immutable(scopes);
}

/**
 * Workspace packages of a monorepo by name (S3): the patterns of the root `package.json`
 * `workspaces` (an array, or `{ packages }`) and of `pnpm-workspace.yaml` select package
 * directories among the manifests discovery already found, so nothing outside the project is read.
 * `*` matches one path segment, `**` any number, and `!pattern` excludes. A name two packages claim is
 * left out: which one an import means is unknown. Unreadable manifests are skipped.
 */
export async function loadWorkspacePackages(projectPath: string, files: readonly FileArtifact[]): Promise<Readonly<Record<string, WorkspacePackage>>> {
  const roots = await findWorkspaceRoots(projectPath, files);
  const byName = new Map<string, WorkspacePackage | null>();
  for (const root of roots) {
    const manifest = await readJson(join(projectPath, root, "package.json"));
    if (manifest === undefined || typeof manifest.name !== "string" || manifest.name.length === 0) continue;
    const entry: WorkspacePackage = {
      root,
      ...(manifest.exports === undefined ? {} : { exports: manifest.exports }),
      ...(typeof manifest.source === "string" ? { source: manifest.source } : {}),
      ...(typeof manifest.module === "string" ? { module: manifest.module } : {}),
      ...(typeof manifest.main === "string" ? { main: manifest.main } : {}),
    };
    byName.set(manifest.name, byName.has(manifest.name) ? null : entry);
  }
  const packages: Record<string, WorkspacePackage> = {};
  for (const [name, entry] of [...byName].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))) {
    if (entry !== null) packages[name] = entry;
  }
  return immutable(packages);
}

/**
 * Files a package publishes as entry points (BA-11): `main`, `module`, `types`/`typings`, `bin` and
 * every target of `exports`, for the root package and each workspace package. Their exports are the
 * package's public API, used from outside the project. Targets are matched to discovered files (with
 * the usual extensions and index files); build output that is not in the repository matches nothing.
 */
export async function findPackageEntryFiles(projectPath: string, files: readonly FileArtifact[]): Promise<ReadonlySet<string>> {
  const known = new Set(files.map((file) => canonicalizePath(file.path)));
  const entries = new Set<string>();
  for (const root of ["", ...await findWorkspaceRoots(projectPath, files)]) {
    const manifest = await readJson(join(projectPath, root, "package.json"));
    if (manifest === undefined) continue;
    const targets: string[] = [];
    for (const field of ["main", "module", "types", "typings"]) if (typeof manifest[field] === "string") targets.push(manifest[field] as string);
    if (typeof manifest.bin === "string") targets.push(manifest.bin);
    else if (typeof manifest.bin === "object" && manifest.bin !== null) targets.push(...Object.values(manifest.bin).filter((value): value is string => typeof value === "string"));
    const collect = (value: unknown): void => {
      if (typeof value === "string") { if (!value.includes("*")) targets.push(value); return; }
      if (Array.isArray(value)) { value.forEach(collect); return; }
      if (typeof value === "object" && value !== null) Object.values(value).forEach(collect);
    };
    collect(manifest.exports);
    for (const target of targets) {
      const path = canonicalizePath(posix.join(root, target.replace(/^\.\//, "")));
      if (root !== "" && path !== root && !path.startsWith(`${root}/`)) continue;
      const found = [path, ...[".js", ".ts", ".mjs", ".cjs", ".tsx", ".jsx"].map((extension) => `${path}${extension}`), ...["index.js", "index.ts", "index.mjs", "index.cjs"].map((index) => posix.join(path, index))].find((candidate) => known.has(candidate));
      if (found !== undefined) entries.add(found);
    }
  }
  return entries;
}

/** Project-relative directories of the workspace packages, sorted; empty without a workspace declaration. */
export async function findWorkspaceRoots(projectPath: string, files: readonly FileArtifact[]): Promise<readonly string[]> {
  const patterns = [
    ...workspacePatterns(await readJson(join(projectPath, "package.json"))),
    ...pnpmPatterns(await readText(join(projectPath, "pnpm-workspace.yaml"))),
  ];
  const include = patterns.filter((pattern) => !pattern.startsWith("!")).flatMap(expandBraces).map(globToRegExp);
  const exclude = patterns.filter((pattern) => pattern.startsWith("!")).flatMap((pattern) => expandBraces(pattern.slice(1))).map(globToRegExp);
  if (include.length === 0) return [];
  return files
    .map((file) => canonicalizePath(file.path))
    .filter((path) => path.endsWith("/package.json"))
    .map((path) => path.slice(0, -"/package.json".length))
    .filter((root) => include.some((pattern) => pattern.test(`${root}/`)) && !exclude.some((pattern) => pattern.test(`${root}/`)))
    .sort();
}

function workspacePatterns(manifest: Record<string, unknown> | undefined): readonly string[] {
  const workspaces = manifest?.workspaces;
  const list = Array.isArray(workspaces) ? workspaces
    : typeof workspaces === "object" && workspaces !== null && Array.isArray((workspaces as { packages?: unknown }).packages) ? (workspaces as { packages: unknown[] }).packages
      : [];
  return list.filter((pattern): pattern is string => typeof pattern === "string" && pattern.length > 0);
}

/** `{a,b}/*` → `a/*`, `b/*` (as npm, yarn and pnpm workspace globs allow); nested sets expand too. */
function expandBraces(pattern: string): string[] {
  const match = /\{([^{}]*)\}/.exec(pattern);
  if (match === null) return [pattern];
  return match[1]!.split(",").flatMap((choice) => expandBraces(`${pattern.slice(0, match.index)}${choice}${pattern.slice(match.index + match[0].length)}`));
}

/** The `packages:` list of a pnpm-workspace.yaml: block-style `- item` lines or a flow list `[a, b]`, quoted or not. */
function pnpmPatterns(text: string | undefined): readonly string[] {
  if (text === undefined) return [];
  const flow = /^packages:\s*\[([^\]]*)\]/m.exec(text);
  if (flow !== null) {
    return flow[1]!.split(",").map((item) => item.replace(/#.*$/, "").trim().replace(/^(['"])(.*)\1$/, "$2")).filter((item) => item.length > 0);
  }
  const patterns: string[] = [];
  let inPackages = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^packages:\s*(#.*)?$/.test(line)) { inPackages = true; continue; }
    if (!inPackages) continue;
    const item = /^\s+-\s+(.*?)\s*(#.*)?$/.exec(line);
    if (item !== null) {
      const value = item[1]!.replace(/^(['"])(.*)\1$/, "$2");
      if (value.length > 0) patterns.push(value);
      continue;
    }
    if (line.trim().length === 0) continue;
    inPackages = false;
  }
  return patterns;
}

/** Matches a directory path followed by "/": each segment ends in "/", and `**` is any number of segments. */
function globToRegExp(pattern: string): RegExp {
  const segments = posix.normalize(pattern.replaceAll("\\", "/")).replace(/^\.\//, "").replace(/\/+$/, "").split("/");
  const source = segments.map((segment) => segment === "**" ? "(?:[^/]+/)*" : `${segment.split("*").map(escapeRegExp).join("[^/]*")}/`).join("");
  return new RegExp(`^${source}$`);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  const text = await readText(path);
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}
