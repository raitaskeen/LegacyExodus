import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Package root of the analyzer under test (this file is tests/support/analyzer-identity.ts).
const ANALYZER_ROOT = resolve(import.meta.dir, "../..");
const ANALYZER_CONFIGURATION_FILES = ["package.json", "bun.lock", "tsconfig.json"] as const;
const IGNORED_ANALYZER_DIRECTORIES = new Set([".discovery", ".legacy-exodus", ".git", "node_modules"]);

/**
 * Fingerprints the analyzer source under `analyzerRoot` as it is on disk now: every file in
 * `src/` (excluding generated `.discovery` output), package.json, bun.lock, tsconfig.json and
 * the Bun version. Returns undefined when the source cannot be read.
 */
export function fingerprintAnalyzerSource(analyzerRoot: string): string | undefined {
  try {
    const hash = createHash("sha256");
    for (const path of listAnalyzerSourceFiles(join(analyzerRoot, "src"), "src")) {
      hash.update(`file\0${path}\0${sha256(readFileSync(join(analyzerRoot, path)))}\n`);
    }
    for (const name of ANALYZER_CONFIGURATION_FILES) {
      const path = join(analyzerRoot, name);
      hash.update(`file\0${name}\0${existsSync(path) ? sha256(readFileSync(path)) : "<absent>"}\n`);
    }
    hash.update(`runtime\0${Bun.version}\n`);
    return hash.digest("hex");
  } catch {
    return undefined;
  }
}

/**
 * Identity of the analyzer this test process runs. bunfig.toml preloads this module, so it is
 * read before any test file loads the engine and keeps describing that code if the source is
 * edited while the tests run.
 */
export const loadedAnalyzerFingerprint: string | undefined = fingerprintAnalyzerSource(ANALYZER_ROOT);

function listAnalyzerSourceFiles(directory: string, relativeDirectory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!IGNORED_ANALYZER_DIRECTORIES.has(entry.name)) {
        files.push(...listAnalyzerSourceFiles(join(directory, entry.name), relativePath));
      }
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}
