/**
 * Phase 3A — Repository Acquisition Script
 *
 * Reads benchmark manifests from corpus/ directories and fetches each repository into the
 * local .cache/ directory at exactly the commit the manifest pins.
 *
 * A manifest's `revision` is a git tag, kept for readability only: tags are mutable. What is
 * fetched is `commit`, and what every acquired or reused checkout must hash to is `tree`
 * (the git tree SHA of that commit). A checkout whose HEAD tree differs, whose working tree
 * holds modified, deleted, staged, untracked or ignored files (other than the engine's own
 * output directories), or that has no `.git` to check, is rejected rather than used.
 *
 * Usage:
 *   bun run benchmarks/scripts/acquire.ts [--tier tier-1|tier-2|tier-3] [--name repo-name]
 */

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { CACHE_DIR, CORPUS_DIR } from "../paths";
import type { BenchmarkManifest } from "../types";

const GIT_SHA = /^[0-9a-f]{40}$/;

/**
 * Directories, at the checkout root, that the engine writes into an analyzed repository. Untracked
 * or ignored content under them is the engine's output, not drift; a tracked file there is not exempt.
 */
const ENGINE_OUTPUT_DIRS: readonly string[] = [".discovery", ".legacy-exodus"];

/** How many changed paths an integrity error names. */
const MAX_REPORTED_PATHS = 10;

/** A manifest that is complete enough to fetch and verify: every field is validated. */
export interface PinnedRepository {
  readonly name: string;
  readonly repository: string;
  readonly commit: string;
  readonly tree: string;
}

interface GitResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Variables that redirect git to a different repository, index or object store than `cwd` names. */
const REPOSITORY_REDIRECTING_ENV = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
  "GIT_PREFIX",
];

/** The inherited environment minus anything that would point git elsewhere (e.g. when run from a git hook). */
function gitEnvironment(extra: Readonly<Record<string, string>>): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const name of REPOSITORY_REDIRECTING_ENV) delete env[name];
  return { ...env, GIT_TERMINAL_PROMPT: "0", ...extra };
}

/** Runs git with an argument array (never a shell) and never waits for a credential prompt. */
async function git(args: readonly string[], cwd: string, extraEnv: Readonly<Record<string, string>> = {}): Promise<GitResult> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: gitEnvironment(extraEnv),
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

/**
 * Returns the manifest's pin, or throws naming what is missing. A manifest with a
 * repository but without a 40-hex commit and tree is never fetched.
 */
export function requireRepositoryPin(manifest: BenchmarkManifest): PinnedRepository {
  const { name, repository, commit, tree } = manifest;
  if (repository === undefined || repository === "") {
    throw new Error(`Cannot acquire repository '${name}': manifest has no repository URL.`);
  }
  if (repository.startsWith("-")) {
    throw new Error(`Cannot acquire repository '${name}': repository ${JSON.stringify(repository)} could be read as a git option.`);
  }
  if (typeof commit !== "string" || !GIT_SHA.test(commit)) {
    throw new Error(`Cannot acquire repository '${name}': manifest has no 40-hex commit pin (commit: ${JSON.stringify(commit)}).`);
  }
  if (typeof tree !== "string" || !GIT_SHA.test(tree)) {
    throw new Error(`Cannot acquire repository '${name}': manifest has no 40-hex tree pin (tree: ${JSON.stringify(tree)}).`);
  }
  return { name, repository, commit, tree };
}

/**
 * Working-tree entries that differ from `expectedTree`, as `<status> <path>` (e.g. `M lib/a.js`,
 * `D lib/b.js`, `?? extra.js`, `!! ignored.txt`): modified, deleted, untracked and ignored files.
 * Untracked or ignored content under an engine output directory is skipped; a tracked file there is
 * reported like any other.
 *
 * The comparison runs against a throw-away index built from `expectedTree`, never the checkout's own
 * index. The checkout's index is only a cache of what git last saw: it trusts a file whose size and
 * mtime are unchanged, and it can carry assume-unchanged or skip-worktree flags that make git skip a
 * file altogether, so an edit can be invisible to it. A fresh index records no stat data and no flags,
 * which forces git to read every file and compare its content. The checkout's index is left untouched.
 */
async function listChangedPaths(repoDir: string, label: string, expectedTree: string): Promise<readonly string[]> {
  const scratch = await mkdtemp(join(tmpdir(), "lx-pin-index-"));
  let stdout: string;
  try {
    const env = { GIT_INDEX_FILE: join(scratch, "index") };
    const read = await git(["read-tree", expectedTree], repoDir, env);
    if (read.code !== 0) {
      throw new Error(
        `Corpus '${label}' at ${repoDir}: could not read the pinned tree ${expectedTree}: ${read.stderr.trim()}`,
      );
    }
    const result = await git(
      [
        "-c", "core.fsmonitor=false",
        "-c", "core.untrackedCache=false",
        "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=traditional",
      ],
      repoDir,
      env,
    );
    if (result.code !== 0) {
      throw new Error(
        `Corpus '${label}' at ${repoDir}: could not read the working-tree status (expected tree ${expectedTree}): ${result.stderr.trim()}`,
      );
    }
    stdout = result.stdout;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  const entries = stdout.split("\0");
  const changed: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] ?? "";
    if (entry === "") continue;
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    if (/[RC]/.test(status)) i += 1; // a rename or copy is followed by its origin path
    const outsideIndex = status === "??" || status === "!!";
    if (outsideIndex && ENGINE_OUTPUT_DIRS.some((dir) => path.startsWith(`${dir}/`))) continue;
    changed.push(`${status.replaceAll(" ", "")} ${path}`);
  }
  return changed;
}

/**
 * Fails closed unless `repoDir` is its own git checkout whose HEAD tree equals `expectedTree`
 * and whose working tree holds nothing but that tree's files (and the engine's own output
 * directories), judged by content rather than by the checkout's index (see listChangedPaths).
 *
 * The `.git` check is explicit because `git rev-parse` would otherwise walk up out of a
 * checkout-less cache directory and report the tree of whatever repository encloses it.
 * The working-tree check is needed because the engine analyzes files, not the HEAD tree: an
 * edited, deleted or extra file leaves HEAD^{tree} untouched.
 */
export async function verifyPinnedTree(repoDir: string, expectedTree: string, label: string): Promise<void> {
  if (!existsSync(join(repoDir, ".git"))) {
    throw new Error(
      `Corpus '${label}' at ${repoDir} has no .git, so its content cannot be verified (expected tree ${expectedTree}). ` +
      `Remove the directory to re-acquire it.`,
    );
  }
  const result = await git(["rev-parse", "HEAD^{tree}"], repoDir);
  const actual = result.stdout.trim();
  if (result.code !== 0 || !GIT_SHA.test(actual)) {
    throw new Error(
      `Corpus '${label}' at ${repoDir}: could not read the HEAD tree (expected tree ${expectedTree}): ${result.stderr.trim()}`,
    );
  }
  if (actual !== expectedTree) {
    throw new Error(
      `Corpus '${label}' at ${repoDir} does not match its pin: expected tree ${expectedTree}, actual tree ${actual}. ` +
      `Refusing to use unverified content; remove the directory to re-acquire it.`,
    );
  }
  const changed = await listChangedPaths(repoDir, label, expectedTree);
  if (changed.length > 0) {
    const shown = changed.slice(0, MAX_REPORTED_PATHS).join(", ");
    const more = changed.length > MAX_REPORTED_PATHS ? `, and ${changed.length - MAX_REPORTED_PATHS} more` : "";
    throw new Error(
      `Corpus '${label}' at ${repoDir} has the pinned tree ${expectedTree} at HEAD, but its working tree has ` +
      `${changed.length} changed path${changed.length === 1 ? "" : "s"}: ${shown}${more}. ` +
      `Refusing to use modified content; remove the directory to re-acquire it.`,
    );
  }
}

async function requireGit(args: readonly string[], cwd: string, pin: PinnedRepository, step: string): Promise<string> {
  const result = await git(args, cwd);
  if (result.code !== 0) {
    throw new Error(
      `Failed to ${step} for '${pin.name}' (${pin.repository} @ ${pin.commit}), git exit ${result.code}: ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

/**
 * Fetches exactly `pin.commit` into the not-yet-existing `targetDir` and verifies its tree.
 * The directory is created here, so a failed acquisition removes it again rather than
 * leaving something that looks like a cache.
 */
async function acquirePinnedRepository(pin: PinnedRepository, targetDir: string): Promise<void> {
  await mkdir(dirname(targetDir), { recursive: true });
  await mkdir(targetDir);
  try {
    await requireGit(["init", "--quiet"], targetDir, pin, "initialize a repository");
    await requireGit(["remote", "add", "origin", pin.repository], targetDir, pin, "add the origin remote");
    await requireGit(["fetch", "--quiet", "--depth", "1", "origin", pin.commit], targetDir, pin, "fetch the pinned commit");
    await requireGit(["checkout", "--quiet", "--detach", "FETCH_HEAD"], targetDir, pin, "check out the pinned commit");
    const head = (await requireGit(["rev-parse", "HEAD"], targetDir, pin, "read HEAD")).trim();
    if (head !== pin.commit) {
      throw new Error(`Corpus '${pin.name}' checked out ${head} instead of the pinned commit ${pin.commit}.`);
    }
    await verifyPinnedTree(targetDir, pin.tree, pin.name);
  } catch (error: unknown) {
    await rm(targetDir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Makes `targetDir` a verified checkout of the manifest's pinned commit.
 * An existing directory is reused only after its HEAD tree is verified; a missing one is
 * fetched by commit SHA and then verified. Anything unverifiable throws.
 */
export async function ensurePinnedRepository(
  manifest: BenchmarkManifest,
  targetDir: string,
): Promise<"acquired" | "verified"> {
  const pin = requireRepositoryPin(manifest);
  if (existsSync(targetDir)) {
    await verifyPinnedTree(targetDir, pin.tree, pin.name);
    return "verified";
  }
  await acquirePinnedRepository(pin, targetDir);
  return "acquired";
}

/**
 * The corpus manifest called `name`, from whichever tier directory holds it, or null if there is none.
 * A manifest that cannot be parsed throws: skipping it would silently skip its verification too.
 */
export async function findCorpusManifest(name: string): Promise<BenchmarkManifest | null> {
  const entries = await readdir(CORPUS_DIR, { withFileTypes: true }).catch(() => []);
  for (const tier of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()) {
    const manifestPath = join(CORPUS_DIR, tier, `${name}.json`);
    if (existsSync(manifestPath)) {
      return JSON.parse(await readFile(manifestPath, "utf8")) as BenchmarkManifest;
    }
  }
  return null;
}

/**
 * A directory named after a corpus manifest is that corpus. A missing one is fetched at the manifest's
 * pinned commit; an existing one is reused only after it is verified (see verifyPinnedTree). Directories
 * that name no manifest are not corpora and are left alone. Shared by the fidelity test helper and
 * the benchmark runner, so every consumer of a corpus checkout verifies it the same way.
 */
export async function ensureCorpusCheckout(dir: string): Promise<void> {
  const manifest = await findCorpusManifest(basename(dir));
  if (manifest === null) return;
  if (manifest.repository === undefined) {
    if (!existsSync(dir)) {
      throw new Error(`Cannot acquire repository '${manifest.name}': manifest has no repository URL.`);
    }
    return;
  }
  await ensurePinnedRepository(manifest, dir);
}

async function realPathOrSelf(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

/**
 * If `path` lies inside `cacheDir`, verifies (or acquires) the cache entry that contains it with
 * ensureCorpusCheckout, whatever the caller is about to do with the path and whichever manifest
 * fields it has. A path outside the cache is the caller's own repository and is left alone.
 *
 * Both the path as written and its real location are considered, so a link into the cache
 * (a junction, a symlink) is not a way around the check. Every consumer of a cache path calls this:
 * the benchmark runner, `validate`, `fidelity` and the fidelity runner. (The path `cacheDir` itself
 * names no single entry and is not covered.)
 */
export async function ensureCacheEntryVerified(path: string, cacheDir: string = CACHE_DIR): Promise<void> {
  const lexical = [resolve(cacheDir), resolve(path)] as const;
  const real = [await realPathOrSelf(lexical[0]), await realPathOrSelf(lexical[1])] as const;
  const entries = new Set<string>();
  for (const [base, target] of [lexical, real]) {
    const rel = relative(base, target);
    if (rel === "" || rel === ".." || rel.startsWith("..\\") || rel.startsWith("../") || isAbsolute(rel)) continue;
    const [entry] = rel.split(/[\\/]/);
    if (entry !== undefined && entry !== "") entries.add(join(base, entry));
  }
  for (const entry of entries) {
    await ensureCorpusCheckout(entry);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const tierFilter = getArgValue(args, "--tier");
  const nameFilter = getArgValue(args, "--name");

  console.log("LegacyExodus — Repository Acquisition\n");

  const tiers = tierFilter
    ? [tierFilter]
    : await readdir(CORPUS_DIR).catch(() => [] as string[]);

  await mkdir(CACHE_DIR, { recursive: true });

  let acquired = 0;
  let verified = 0;
  let skipped = 0;
  const failed: string[] = [];

  for (const tier of tiers) {
    const tierDir = join(CORPUS_DIR, tier);
    let manifests: string[];
    try {
      manifests = (await readdir(tierDir)).filter((f) => f.endsWith(".json"));
    } catch {
      continue;
    }

    for (const manifestFile of manifests) {
      const manifest = JSON.parse(
        await readFile(join(tierDir, manifestFile), "utf8"),
      ) as BenchmarkManifest;

      if (nameFilter && manifest.name !== nameFilter) continue;

      if (manifest.localPath) {
        console.log(`  [skip] ${manifest.name} — local path: ${manifest.localPath}`);
        skipped++;
        continue;
      }

      if (!manifest.repository) {
        console.log(`  [skip] ${manifest.name} — no repository URL`);
        skipped++;
        continue;
      }

      const targetDir = join(CACHE_DIR, manifest.name);
      console.log(
        existsSync(targetDir)
          ? `  [verify] ${manifest.name} → ${targetDir}`
          : `  [fetch] ${manifest.name} @ ${manifest.revision ?? "?"} (${manifest.commit ?? "unpinned"})`,
      );

      try {
        const outcome = await ensurePinnedRepository(manifest, targetDir);
        console.log(outcome === "acquired" ? `    ✓ Acquired` : `    ✓ Verified`);
        if (outcome === "acquired") acquired++;
        else verified++;
      } catch (error: unknown) {
        console.error(`    ✗ ${error instanceof Error ? error.message : String(error)}`);
        failed.push(manifest.name);
      }
    }
  }

  console.log(`\nDone: ${acquired} acquired, ${verified} verified, ${skipped} skipped, ${failed.length} failed.`);
  if (failed.length > 0) {
    console.error(`Failed: ${failed.join(", ")}`);
    process.exitCode = 1;
  }
}

function getArgValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error("Acquisition failed:", error);
    process.exit(1);
  });
}
