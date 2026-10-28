/**
 * BA-20 / A6 - `bun run benchmark run` uses the same verified acquisition as the fidelity tests.
 *
 * The runner used to read benchmarks/.cache/<name> without any check. These tests drive
 * runBenchmark with a throw-away local "remote" and cache, so nothing touches the network or
 * the real benchmarks/.cache. runBenchmark runs in a child process, like the audit test, so
 * benchmark runner code stays out of this file's typecheck scope.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { ensurePinnedRepository } from "../../../benchmarks/scripts/acquire";
import type { BenchmarkManifest } from "../../../benchmarks/types";

const PACKAGE_ROOT = resolve(import.meta.dir, "../../..");
const RUNNER_MODULE = join(PACKAGE_ROOT, "benchmarks", "runner.ts");
const FIXTURE_DIR = join(PACKAGE_ROOT, "benchmarks", "fixtures", "governance-audit");
const RUN_TIMEOUT_MS = 120_000;

const RUNNER_DRIVER = [
  "const [modulePath, optionsJson] = process.argv.slice(-2);",
  "const { runBenchmark } = await import(modulePath);",
  "await runBenchmark(JSON.parse(optionsJson));",
].join("\n");

const COMMITTER = ["-c", "user.name=Pin Test", "-c", "user.email=pin-test@example.com", "-c", "commit.gpgsign=false"];

function git(cwd: string, ...args: readonly string[]): string {
  const result = spawnSync("git", [...COMMITTER, ...args], { cwd, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd} (exit ${result.status}): ${result.stderr}`);
  }
  return result.stdout.trim();
}

interface RunOutcome {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runBenchmarkInChild(options: Readonly<Record<string, unknown>>): RunOutcome {
  const result = spawnSync("bun", ["-e", RUNNER_DRIVER, RUNNER_MODULE, JSON.stringify(options)], {
    cwd: PACKAGE_ROOT,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    timeout: RUN_TIMEOUT_MS,
    windowsHide: true,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

let workRoot = "";
let sourceDir = "";
let commit = "";
let tree = "";
let counter = 0;

beforeAll(async () => {
  workRoot = await mkdtemp(join(tmpdir(), "lx-corpus-runner-"));
  sourceDir = join(workRoot, "source");
  await cp(FIXTURE_DIR, sourceDir, { recursive: true });
  git(sourceDir, "init", "--quiet");
  git(sourceDir, "add", "-A");
  git(sourceDir, "commit", "--quiet", "-m", "pinned");
  commit = git(sourceDir, "rev-parse", "HEAD");
  tree = git(sourceDir, "rev-parse", `${commit}^{tree}`);
});

afterAll(async () => {
  await rm(workRoot, { recursive: true, force: true });
});

function demoManifest(): BenchmarkManifest {
  return {
    name: "demo",
    repository: sourceDir,
    revision: "v1",
    commit,
    tree,
    tier: "tier-1",
    languageProfile: ["javascript"],
    frameworkProfile: [],
    sizeClass: "small",
    license: "MIT",
    reason: "runner pin test",
  };
}

/** A manifest file plus fresh cache and output directories. */
async function scenario(): Promise<{ readonly options: Readonly<Record<string, unknown>>; readonly cacheDir: string; readonly demoDir: string }> {
  counter += 1;
  const root = join(workRoot, `scenario-${counter}`);
  await mkdir(root, { recursive: true });
  const manifestPath = join(root, "demo.json");
  await writeFile(manifestPath, JSON.stringify(demoManifest()), "utf8");
  const cacheDir = join(root, "cache");
  return {
    options: { target: manifestPath, runs: 2, cacheDir, outputDir: join(root, "results") },
    cacheDir,
    demoDir: join(cacheDir, "demo"),
  };
}

describe("BA-20 / A6: benchmark run verifies its cache", () => {
  it("acquires a missing cache at the pinned commit, runs, and verifies the reused cache on the next run", async () => {
    const { options, demoDir } = await scenario();

    const first = runBenchmarkInChild(options);
    expect({ code: first.code, stderr: first.stderr }).toEqual({ code: 0, stderr: first.stderr });
    expect(git(demoDir, "rev-parse", "HEAD")).toBe(commit);
    expect(existsSync(join(demoDir, ".discovery"))).toBe(true);

    // The reused cache now holds the engine's own untracked output; it must not count as drift.
    const second = runBenchmarkInChild(options);
    expect({ code: second.code, stderr: second.stderr }).toEqual({ code: 0, stderr: second.stderr });
  }, RUN_TIMEOUT_MS * 2);

  it("refuses a cache whose tracked file was edited, names it, and leaves the cache untouched", async () => {
    const { options, demoDir } = await scenario();
    await ensurePinnedRepository(demoManifest(), demoDir);
    await writeFile(join(demoDir, "src", "math.js"), "export const tampered = true;\n", "utf8");

    const outcome = runBenchmarkInChild(options);

    expect(outcome.code).not.toBe(0);
    expect(outcome.stderr).toContain("M src/math.js");
    expect(await readFile(join(demoDir, "src", "math.js"), "utf8")).toBe("export const tampered = true;\n");
    expect(existsSync(join(demoDir, ".discovery"))).toBe(false);
  }, RUN_TIMEOUT_MS);

  it("refuses a cache with an extra untracked file", async () => {
    const { options, demoDir } = await scenario();
    await ensurePinnedRepository(demoManifest(), demoDir);
    await writeFile(join(demoDir, "extra.js"), "export const extra = 1;\n", "utf8");

    const outcome = runBenchmarkInChild(options);

    expect(outcome.code).not.toBe(0);
    expect(outcome.stderr).toContain("?? extra.js");
  }, RUN_TIMEOUT_MS);

  it("refuses a cache whose HEAD tree is not the pinned tree, naming both trees", async () => {
    const { options, demoDir } = await scenario();
    await ensurePinnedRepository(demoManifest(), demoDir);
    await writeFile(join(demoDir, "src", "math.js"), "export const moved = true;\n", "utf8");
    git(demoDir, "commit", "--quiet", "-am", "move HEAD");
    const driftedTree = git(demoDir, "rev-parse", "HEAD^{tree}");

    const outcome = runBenchmarkInChild(options);

    expect(outcome.code).not.toBe(0);
    expect(outcome.stderr).toContain(`expected tree ${tree}`);
    expect(outcome.stderr).toContain(`actual tree ${driftedTree}`);
  }, RUN_TIMEOUT_MS);

  describe("a repository path directly inside the benchmark cache", () => {
    const msPin = (): BenchmarkManifest =>
      JSON.parse(readFileSync(join(PACKAGE_ROOT, "benchmarks", "corpus", "tier-1", "ms.json"), "utf8")) as BenchmarkManifest;

    it("is verified against its corpus manifest", async () => {
      const { cacheDir } = await scenario();
      const target = join(cacheDir, "ms");
      await mkdir(target, { recursive: true });
      await cp(FIXTURE_DIR, target, { recursive: true });
      git(target, "init", "--quiet");
      git(target, "add", "-A");
      git(target, "commit", "--quiet", "-m", "not the ms corpus");

      const outcome = runBenchmarkInChild({ target, runs: 2, cacheDir, outputDir: join(cacheDir, "..", "results") });

      expect(outcome.code).not.toBe(0);
      expect(outcome.stderr).toContain(`expected tree ${msPin().tree}`);
    }, RUN_TIMEOUT_MS);

    it("is refused when it has no .git", async () => {
      const { cacheDir } = await scenario();
      const target = join(cacheDir, "ms");
      await mkdir(target, { recursive: true });
      await cp(FIXTURE_DIR, target, { recursive: true });

      const outcome = runBenchmarkInChild({ target, runs: 2, cacheDir, outputDir: join(cacheDir, "..", "results") });

      expect(outcome.code).not.toBe(0);
      expect(outcome.stderr).toContain("no .git");
    }, RUN_TIMEOUT_MS);
  });
});
