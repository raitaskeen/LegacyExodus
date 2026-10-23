import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createLegacyExodusEngine } from "@runtime/composition/services";
import { CORPUS_DIR } from "../../../benchmarks/paths";
import type { BenchmarkManifest } from "../../../benchmarks/types";

async function findCorpusManifest(repoName: string): Promise<BenchmarkManifest | null> {
  const tiers = ["tier-1", "tier-2", "tier-3"];
  for (const tier of tiers) {
    const manifestPath = join(CORPUS_DIR, tier, `${repoName}.json`);
    if (existsSync(manifestPath)) {
      try {
        const raw = await readFile(manifestPath, "utf8");
        return JSON.parse(raw) as BenchmarkManifest;
      } catch {}
    }
  }

  try {
    const entries = await readdir(CORPUS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const candidate = join(CORPUS_DIR, entry.name, `${repoName}.json`);
        if (existsSync(candidate)) {
          const raw = await readFile(candidate, "utf8");
          return JSON.parse(raw) as BenchmarkManifest;
        }
      }
    }
  } catch {}

  return null;
}

async function acquireRepository(manifest: BenchmarkManifest, targetDir: string): Promise<void> {
  if (!manifest.repository) {
    throw new Error(`Cannot acquire repository '${manifest.name}': manifest has no repository URL.`);
  }

  await mkdir(dirname(targetDir), { recursive: true });

  const cloneArgs = ["clone", "--depth", "1"];
  if (manifest.revision) {
    cloneArgs.push("--branch", manifest.revision);
  }
  cloneArgs.push(manifest.repository, targetDir);

  const proc = Bun.spawn(["git", ...cloneArgs], {
    stdout: "ignore",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();

    if (manifest.revision && stderr.includes("Could not find remote branch")) {
      const fullClone = Bun.spawn(["git", "clone", manifest.repository, targetDir], {
        stdout: "ignore",
        stderr: "pipe",
      });
      const fullExitCode = await fullClone.exited;
      if (fullExitCode === 0) {
        const checkout = Bun.spawn(["git", "checkout", manifest.revision], {
          cwd: targetDir,
          stdout: "ignore",
          stderr: "ignore",
        });
        await checkout.exited;
        return;
      }
    }

    throw new Error(`Failed to clone repository '${manifest.name}' from ${manifest.repository}: ${stderr.trim()}`);
  }
}

const ANALYZER_ROOT = resolve(import.meta.dir, "../../..");
const ANALYZER_CONFIGURATION_FILES = ["package.json", "bun.lock", "tsconfig.json"] as const;
const IGNORED_ANALYZER_DIRECTORIES = new Set([".discovery", ".legacy-exodus", ".git", "node_modules"]);

// Written next to the projection; deliberately not `*.json`, so tools that enumerate
// `.discovery/*.json` as analysis artifacts never see it.
const IDENTITY_RECORD_FILE = "fidelity-helper.identity";

/**
 * Fingerprints the analyzer source under `analyzerRoot`: every file in `src/` (excluding
 * generated `.discovery` output), package.json, bun.lock, tsconfig.json and the Bun version.
 * Returns undefined when the source cannot be read, which makes every projection non-reusable.
 */
async function computeAnalyzerFingerprint(analyzerRoot: string): Promise<string | undefined> {
  try {
    const hash = createHash("sha256");
    for (const path of await listAnalyzerSourceFiles(join(analyzerRoot, "src"), "src")) {
      hash.update(`file\0${path}\0${sha256(await readFile(join(analyzerRoot, path)))}\n`);
    }
    for (const name of ANALYZER_CONFIGURATION_FILES) {
      const path = join(analyzerRoot, name);
      hash.update(`file\0${name}\0${existsSync(path) ? sha256(await readFile(path)) : "<absent>"}\n`);
    }
    hash.update(`runtime\0${Bun.version}\n`);
    return hash.digest("hex");
  } catch {
    return undefined;
  }
}

async function listAnalyzerSourceFiles(directory: string, relativeDirectory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!IGNORED_ANALYZER_DIRECTORIES.has(entry.name)) {
        files.push(...await listAnalyzerSourceFiles(join(directory, entry.name), relativePath));
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

// The in-process engine was imported above; capturing its source identity once, now, keeps a
// record describing the code that produced the projection even if the source is edited mid-run.
const loadedAnalyzerFingerprint = computeAnalyzerFingerprint(ANALYZER_ROOT);

async function isRecordedProjectionCurrent(discoveryDir: string, analyzerFingerprint: string): Promise<boolean> {
  try {
    const record = JSON.parse(await readFile(join(discoveryDir, IDENTITY_RECORD_FILE), "utf8"));
    const manifest = await readFile(join(discoveryDir, "manifest.json"));
    return record?.analyzerFingerprint === analyzerFingerprint && record?.manifestSha256 === sha256(manifest);
  } catch {
    return false;
  }
}

/**
 * Ensures that discovery projections produced by the current analyzer exist on disk for the given repository.
 * If the target repository is not present in .cache, acquires it on-demand from its corpus manifest.
 *
 * An existing projection is reused only when the helper itself generated it and recorded, next to it,
 * the analyzer source fingerprint and the digest of the manifest it produced. Git HEAD and the manifest's
 * engine SHA are not analyzer identity: neither changes while engine edits are uncommitted. Otherwise the
 * engine regenerates the projection with `refresh`, bypassing the engine's own snapshot reuse.
 *
 * `analyzerRoot` (default: this package) names the analyzer source tree to fingerprint. For the default
 * root the fingerprint is captured once per process, when the in-process engine is loaded; an explicit
 * root is fingerprinted on every call so tests can model analyzer source changes.
 */
export async function ensureDiscoveryProjections(
  repoPath: string,
  options?: { readonly force?: boolean; readonly analyzerRoot?: string },
): Promise<void> {
  const absPath = resolve(repoPath);
  const discoveryDir = join(absPath, ".discovery");
  const analyzerFingerprint = options?.analyzerRoot === undefined
    ? await loadedAnalyzerFingerprint
    : await computeAnalyzerFingerprint(resolve(options.analyzerRoot));

  if (
    !options?.force &&
    analyzerFingerprint !== undefined &&
    existsSync(join(discoveryDir, "files.json")) &&
    await isRecordedProjectionCurrent(discoveryDir, analyzerFingerprint)
  ) {
    return;
  }

  await rm(join(discoveryDir, IDENTITY_RECORD_FILE), { force: true });

  if (!existsSync(absPath)) {
    const repoName = basename(absPath);
    const manifest = await findCorpusManifest(repoName);
    if (manifest) {
      await acquireRepository(manifest, absPath);
    }
  }

  if (!existsSync(absPath)) {
    throw new Error(
      `Repository directory not found at: ${absPath}. ` +
      `Fidelity tests require target repository to be acquired or present.`,
    );
  }

  const engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });
  await engine.initialize();
  try {
    await engine.execute({
      id: "00000000-0000-4000-8000-000000000099",
      type: "AnalyzeProject",
      createdAt: new Date(),
      payload: {
        projectId: "00000000-0000-4000-8000-000000000098",
        path: absPath,
        refresh: true,
      },
    });
  } finally {
    await engine.shutdown();
  }

  if (analyzerFingerprint !== undefined) {
    const manifest = await readFile(join(discoveryDir, "manifest.json"));
    await writeFile(
      join(discoveryDir, IDENTITY_RECORD_FILE),
      JSON.stringify({ schemaVersion: 1, analyzerFingerprint, manifestSha256: sha256(manifest) }),
      "utf8",
    );
  }
}
