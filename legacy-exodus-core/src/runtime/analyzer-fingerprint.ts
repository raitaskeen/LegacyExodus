import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const ANALYZER_FINGERPRINT_PREFIX = "lx-analyzer-v1:";

/** Root of the analyzer package: the directory holding package.json and src/. */
export const defaultAnalyzerRoot = resolve(import.meta.dir, "../..");

const ignoredDirectories = new Set([".discovery", ".legacy-exodus", ".git", "node_modules"]);
const configurationFiles = ["package.json", "bun.lock", "tsconfig.json"] as const;
const cachedFingerprints = new Map<string, Promise<string | undefined>>();

/**
 * Identifies the analyzer build that produces analysis artifacts.
 *
 * Covers every analyzer source file, the package manifest, lockfile and compiler
 * configuration, the installed versions of runtime dependencies, and the runtime
 * version. Generated discovery output inside the source tree is excluded.
 *
 * @returns The fingerprint, or `undefined` when the analyzer source cannot be read.
 *   Callers must treat an unavailable fingerprint as "no reusable identity".
 */
export async function computeAnalyzerFingerprint(root: string = defaultAnalyzerRoot): Promise<string | undefined> {
  try {
    const hash = createHash("sha256");
    for (const path of await listFiles(join(root, "src"), "src")) {
      hash.update(`file\0${path}\0${digest(await readFile(join(root, path)))}\n`);
    }

    let manifest: unknown;
    for (const name of configurationFiles) {
      const content = await readOptional(join(root, name));
      hash.update(`file\0${name}\0${content === undefined ? "<absent>" : digest(content)}\n`);
      if (name === "package.json" && content !== undefined) manifest = JSON.parse(content.toString("utf8"));
    }

    for (const dependency of runtimeDependencies(manifest)) {
      hash.update(`dependency\0${dependency}\0${await installedVersion(root, dependency)}\n`);
    }

    hash.update(`runtime\0${typeof process.versions.bun === "string" ? `bun-${process.versions.bun}` : process.version}\n`);
    return `${ANALYZER_FINGERPRINT_PREFIX}${hash.digest("hex")}`;
  } catch {
    return undefined;
  }
}

/** Computes the fingerprint once per analyzer root for the life of the process. */
export function getAnalyzerFingerprint(root: string = defaultAnalyzerRoot): Promise<string | undefined> {
  const key = resolve(root);
  let fingerprint = cachedFingerprints.get(key);
  if (fingerprint === undefined) {
    fingerprint = computeAnalyzerFingerprint(key);
    cachedFingerprints.set(key, fingerprint);
  }
  return fingerprint;
}

async function listFiles(directory: string, relativeDirectory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) files.push(...await listFiles(join(directory, entry.name), relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  // Code-unit order keeps the fingerprint independent of the host locale.
  return files.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function runtimeDependencies(manifest: unknown): string[] {
  if (typeof manifest !== "object" || manifest === null || !("dependencies" in manifest)) return [];
  const dependencies = (manifest as { readonly dependencies: unknown }).dependencies;
  if (typeof dependencies !== "object" || dependencies === null) return [];
  return Object.keys(dependencies).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

async function installedVersion(root: string, dependency: string): Promise<string> {
  try {
    const manifest: unknown = JSON.parse(await readFile(join(root, "node_modules", dependency, "package.json"), "utf8"));
    const version = typeof manifest === "object" && manifest !== null && "version" in manifest
      ? (manifest as { readonly version: unknown }).version
      : undefined;
    return typeof version === "string" ? version : "<unversioned>";
  } catch {
    return "<unresolved>";
  }
}

async function readOptional(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function digest(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}
