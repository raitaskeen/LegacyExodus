/**
 * BA-20 / A6 - Every consumer that analyzes a path inside benchmarks/.cache verifies the cache entry.
 *
 * Consumers: ensureCacheEntryVerified (shared), runFidelityValidation, and the benchmark CLI's
 * `validate` and `fidelity` commands. (The benchmark runner has its own tests in corpus-runner.test.ts.)
 * The "cache" is a temp directory handed over via cacheDir / --cache-dir, and the entry is named after the
 * real `ms` corpus so the real manifest's pin is what it is checked against. No test touches the network
 * or the real benchmarks/.cache: the entries hold other content, so they must be rejected.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { runFidelityValidation } from "../../../benchmarks/fidelity/runner";
import { ensureCacheEntryVerified } from "../../../benchmarks/scripts/acquire";
import type { BenchmarkManifest } from "../../../benchmarks/types";

const PACKAGE_ROOT = resolve(import.meta.dir, "../../..");
const CLI = join(PACKAGE_ROOT, "benchmarks", "cli.ts");
const FIXTURE_DIR = join(PACKAGE_ROOT, "benchmarks", "fixtures", "governance-audit");
const CLI_TIMEOUT_MS = 120_000;

const msTree = (JSON.parse(
  readFileSync(join(PACKAGE_ROOT, "benchmarks", "corpus", "tier-1", "ms.json"), "utf8"),
) as BenchmarkManifest).tree as string;

const COMMITTER = ["-c", "user.name=Pin Test", "-c", "user.email=pin-test@example.com", "-c", "commit.gpgsign=false"];

function git(cwd: string, ...args: readonly string[]): void {
  const result = spawnSync("git", [...COMMITTER, ...args], { cwd, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd} (exit ${result.status}): ${result.stderr}`);
  }
}

function runCli(...args: readonly string[]): { readonly code: number | null; readonly stdout: string; readonly stderr: string } {
  const result = spawnSync("bun", [CLI, ...args], {
    cwd: PACKAGE_ROOT,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    timeout: CLI_TIMEOUT_MS,
    windowsHide: true,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected the promise to reject");
}

let workRoot = "";
let counter = 0;

beforeAll(async () => {
  workRoot = await mkdtemp(join(tmpdir(), "lx-cache-entry-"));
});

afterAll(async () => {
  await rm(workRoot, { recursive: true, force: true });
});

/** A cache directory whose `ms` entry is a git repository, but not the pinned ms content. */
async function cacheWithImpostorMs(): Promise<{ readonly cacheDir: string; readonly ms: string }> {
  counter += 1;
  const cacheDir = join(workRoot, `cache-${counter}`);
  const ms = join(cacheDir, "ms");
  await mkdir(cacheDir, { recursive: true });
  await cp(FIXTURE_DIR, ms, { recursive: true });
  git(ms, "init", "--quiet");
  git(ms, "add", "-A");
  git(ms, "commit", "--quiet", "-m", "not the ms corpus");
  return { cacheDir, ms };
}

/** The same content outside any cache, named like a corpus. */
async function ordinaryRepositoryNamedMs(): Promise<string> {
  counter += 1;
  const ms = join(workRoot, `elsewhere-${counter}`, "ms");
  await cp(FIXTURE_DIR, ms, { recursive: true });
  return ms;
}

describe("BA-20 / A6: ensureCacheEntryVerified", () => {
  it("verifies the cache entry named by a path directly inside the cache", async () => {
    const { cacheDir, ms } = await cacheWithImpostorMs();

    expect(await rejection(ensureCacheEntryVerified(ms, cacheDir))).toContain(`expected tree ${msTree}`);
  });

  it("verifies the entry that contains a deeper path", async () => {
    const { cacheDir, ms } = await cacheWithImpostorMs();

    expect(await rejection(ensureCacheEntryVerified(join(ms, "src"), cacheDir))).toContain(`expected tree ${msTree}`);
  });

  it("verifies the entry behind a link that points into the cache", async () => {
    const { cacheDir, ms } = await cacheWithImpostorMs();
    const link = join(workRoot, `link-${counter}`);
    await symlink(ms, link, "junction");

    expect(await rejection(ensureCacheEntryVerified(link, cacheDir))).toContain(`expected tree ${msTree}`);
  });

  it("leaves a repository outside the cache alone, even when it is named like a corpus", async () => {
    const { cacheDir } = await cacheWithImpostorMs();

    await ensureCacheEntryVerified(await ordinaryRepositoryNamedMs(), cacheDir);
  });

  it("leaves a cache entry that is not a corpus alone", async () => {
    const { cacheDir } = await cacheWithImpostorMs();
    await mkdir(join(cacheDir, "scratch"), { recursive: true });

    await ensureCacheEntryVerified(join(cacheDir, "scratch"), cacheDir);
  });
});

describe("BA-20 / A6: runFidelityValidation verifies a repository inside the cache", () => {
  it("rejects a cache entry whose tree is not the pinned tree, before reading any discovery output", async () => {
    const { cacheDir, ms } = await cacheWithImpostorMs();

    expect(await rejection(runFidelityValidation({ repoPath: ms, cacheDir }))).toContain(`expected tree ${msTree}`);
  });

  it("does not verify a repository outside the cache (control: it fails later, on the missing discovery manifest)", async () => {
    const { cacheDir } = await cacheWithImpostorMs();

    const message = await rejection(runFidelityValidation({ repoPath: await ordinaryRepositoryNamedMs(), cacheDir }));

    expect(message).toContain("Missing required discovery manifest");
    expect(message).not.toContain("expected tree");
  });
});

describe("BA-20 / A6: the benchmark CLI verifies a repository inside the cache", () => {
  it("validate rejects a cache entry whose tree is not the pinned tree", async () => {
    const { cacheDir, ms } = await cacheWithImpostorMs();

    const outcome = runCli("validate", ms, "--cache-dir", cacheDir);

    expect(outcome.code).not.toBe(0);
    expect(outcome.stderr).toContain(`expected tree ${msTree}`);
  }, CLI_TIMEOUT_MS);

  it("validate analyzes a repository outside the cache without verification (control)", async () => {
    const { cacheDir } = await cacheWithImpostorMs();

    const outcome = runCli("validate", await ordinaryRepositoryNamedMs(), "--cache-dir", cacheDir);

    expect({ code: outcome.code, stderr: outcome.stderr }).toEqual({ code: 0, stderr: outcome.stderr });
    expect(outcome.stdout).toContain("Reconciled");
  }, CLI_TIMEOUT_MS);

  it("fidelity rejects a cache entry whose tree is not the pinned tree", async () => {
    const { cacheDir, ms } = await cacheWithImpostorMs();

    const outcome = runCli("fidelity", ms, "--cache-dir", cacheDir);

    expect(outcome.code).not.toBe(0);
    expect(outcome.stderr).toContain(`expected tree ${msTree}`);
  }, CLI_TIMEOUT_MS);
});
