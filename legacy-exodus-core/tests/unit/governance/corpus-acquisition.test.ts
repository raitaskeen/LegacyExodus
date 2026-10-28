/**
 * BA-20 / A6 - Acquisition fetches exactly the pinned commit and every use of a
 * cached checkout is verified against the manifest's tree.
 *
 * These tests never touch the network: the "remote" is a throw-away local git
 * repository, fetched by commit SHA exactly as the real corpora are fetched from GitHub.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ensurePinnedRepository,
  requireRepositoryPin,
  verifyPinnedTree,
} from "../../../benchmarks/scripts/acquire";
import type { BenchmarkManifest } from "../../../benchmarks/types";

const WRONG_TREE = "0123456789abcdef0123456789abcdef01234567";
const COMMITTER = ["-c", "user.name=Pin Test", "-c", "user.email=pin-test@example.com", "-c", "commit.gpgsign=false"];

function git(cwd: string, ...args: readonly string[]): string {
  const result = spawnSync("git", [...COMMITTER, ...args], { cwd, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd} (exit ${result.status}): ${result.stderr}`);
  }
  return result.stdout.trim();
}

function gitSucceeds(cwd: string, ...args: readonly string[]): boolean {
  return spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).status === 0;
}

interface SourceRepo {
  readonly dir: string;
  /** Older commit: not the tip, so only a fetch by SHA (not by branch or tag) can reach it. */
  readonly first: { readonly commit: string; readonly tree: string };
  readonly tip: { readonly commit: string; readonly tree: string };
}

let workRoot = "";
let source: SourceRepo;
let counter = 0;

beforeAll(async () => {
  workRoot = await mkdtemp(join(tmpdir(), "lx-corpus-pin-"));
  const dir = join(workRoot, "source");
  await mkdir(dir);
  git(dir, "init", "--quiet");
  await writeFile(join(dir, "lib.js"), "module.exports = 'first';", "utf8");
  git(dir, "add", "-A");
  git(dir, "commit", "--quiet", "-m", "first");
  const firstCommit = git(dir, "rev-parse", "HEAD");
  await writeFile(join(dir, "lib.js"), "module.exports = 'tip';", "utf8");
  git(dir, "commit", "--quiet", "-am", "tip");
  const tipCommit = git(dir, "rev-parse", "HEAD");
  source = {
    dir,
    first: { commit: firstCommit, tree: git(dir, "rev-parse", `${firstCommit}^{tree}`) },
    tip: { commit: tipCommit, tree: git(dir, "rev-parse", `${tipCommit}^{tree}`) },
  };
});

afterAll(async () => {
  await rm(workRoot, { recursive: true, force: true });
});

function freshTarget(): string {
  counter += 1;
  return join(workRoot, `cache-${counter}`, "demo");
}

function manifestFor(overrides: Partial<BenchmarkManifest> = {}): BenchmarkManifest {
  return {
    name: "demo",
    repository: source.dir,
    revision: "v1",
    commit: source.first.commit,
    tree: source.first.tree,
    languageProfile: ["javascript"],
    frameworkProfile: [],
    sizeClass: "small",
    license: "MIT",
    reason: "pin test",
    ...overrides,
  };
}

describe("BA-20 / A6: verifyPinnedTree", () => {
  it("accepts a checkout whose HEAD tree equals the pin", async () => {
    await verifyPinnedTree(source.dir, source.tip.tree, "demo");
  });

  it("rejects a wrong pin and names the expected and the actual tree", async () => {
    const failure = await verifyPinnedTree(source.dir, WRONG_TREE, "demo").then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    expect(message).toContain("demo");
    expect(message).toContain(`expected tree ${WRONG_TREE}`);
    expect(message).toContain(`actual tree ${source.tip.tree}`);
  });

  it("rejects a pin that is the commit SHA instead of the tree SHA", async () => {
    await expect(verifyPinnedTree(source.dir, source.tip.commit, "demo")).rejects.toThrow(
      new RegExp(`expected tree ${source.tip.commit}.*actual tree ${source.tip.tree}`),
    );
  });

  it("fails closed when the directory has no .git, even inside another git repository", async () => {
    // Without an explicit check, `git rev-parse` would walk up and report the enclosing repository's tree.
    const nested = join(source.dir, "not-a-checkout");
    await mkdir(nested, { recursive: true });
    try {
      expect(gitSucceeds(nested, "rev-parse", "HEAD^{tree}")).toBe(true);
      await expect(verifyPinnedTree(nested, source.tip.tree, "demo")).rejects.toThrow(/no \.git/);
    } finally {
      await rm(nested, { recursive: true, force: true });
    }
  });

  it("fails closed when the directory does not exist", async () => {
    await expect(verifyPinnedTree(join(workRoot, "absent"), source.tip.tree, "demo")).rejects.toThrow(/no \.git/);
  });
});

describe("BA-20 / A6: requireRepositoryPin", () => {
  it("returns the repository, commit and tree of a fully pinned manifest", () => {
    expect(requireRepositoryPin(manifestFor())).toEqual({
      name: "demo",
      repository: source.dir,
      commit: source.first.commit,
      tree: source.first.tree,
    });
  });

  it("rejects a manifest without a repository", () => {
    expect(() => requireRepositoryPin(manifestFor({ repository: undefined }))).toThrow(/no repository/);
  });

  // Overrides are functions because `source` only exists once beforeAll has run.
  const invalidPins: readonly (readonly [string, () => Partial<BenchmarkManifest>, "commit" | "tree"])[] = [
    ["a missing commit", () => ({ commit: undefined }), "commit"],
    ["a missing tree", () => ({ tree: undefined }), "tree"],
    ["a short commit", () => ({ commit: "abc1234" }), "commit"],
    ["an upper-case tree", () => ({ tree: source.first.tree.toUpperCase() }), "tree"],
    ["a branch-like commit", () => ({ commit: "main" }), "commit"],
    ["a commit with trailing text", () => ({ commit: `${source.first.commit} --upload-pack=x` }), "commit"],
  ];
  for (const [label, overrides, field] of invalidPins) {
    it(`rejects ${label} and names the field`, () => {
      expect(() => requireRepositoryPin(manifestFor(overrides()))).toThrow(new RegExp(`40-hex ${field}`));
    });
  }

  it("rejects a repository that could be read as a git option", () => {
    expect(() => requireRepositoryPin(manifestFor({ repository: "--upload-pack=calc" }))).toThrow(/repository/);
  });
});

describe("BA-20 / A6: ensurePinnedRepository", () => {
  it("acquires exactly the pinned commit, even when it is not the tip", async () => {
    const target = freshTarget();

    const outcome = await ensurePinnedRepository(manifestFor(), target);

    expect(outcome).toBe("acquired");
    expect(git(target, "rev-parse", "HEAD")).toBe(source.first.commit);
    expect(git(target, "rev-parse", "HEAD^{tree}")).toBe(source.first.tree);
    expect(await readFile(join(target, "lib.js"), "utf8")).toBe("module.exports = 'first';");
    expect(git(target, "rev-parse", "--is-shallow-repository")).toBe("true");
    expect(gitSucceeds(target, "symbolic-ref", "-q", "HEAD")).toBe(false);
    expect(git(target, "remote", "get-url", "origin")).toBe(source.dir);
  });

  it("verifies and reuses an existing checkout without contacting the remote", async () => {
    const target = freshTarget();
    await ensurePinnedRepository(manifestFor(), target);

    const outcome = await ensurePinnedRepository(manifestFor({ repository: join(workRoot, "unreachable") }), target);

    expect(outcome).toBe("verified");
    expect(git(target, "rev-parse", "HEAD")).toBe(source.first.commit);
  });

  it("fails closed on reuse when the cached HEAD no longer has the pinned tree, and keeps the evidence", async () => {
    const target = freshTarget();
    await ensurePinnedRepository(manifestFor(), target);
    await writeFile(join(target, "lib.js"), "module.exports = 'tampered';", "utf8");
    git(target, "commit", "--quiet", "-am", "tamper");
    const driftedTree = git(target, "rev-parse", "HEAD^{tree}");

    const failure = await ensurePinnedRepository(manifestFor(), target).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(`expected tree ${source.first.tree}`);
    expect((failure as Error).message).toContain(`actual tree ${driftedTree}`);
    expect(existsSync(join(target, ".git"))).toBe(true);
  });

  it("fails closed on reuse when the cache directory has no .git", async () => {
    const target = freshTarget();
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "lib.js"), "module.exports = 'first';", "utf8");

    await expect(ensurePinnedRepository(manifestFor(), target)).rejects.toThrow(/no \.git/);
    expect(existsSync(join(target, "lib.js"))).toBe(true);
  });

  it("fails closed on a fresh acquisition whose content does not match the pinned tree, leaving no usable cache", async () => {
    const target = freshTarget();

    const failure = await ensurePinnedRepository(manifestFor({ tree: WRONG_TREE }), target).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(`expected tree ${WRONG_TREE}`);
    expect((failure as Error).message).toContain(`actual tree ${source.first.tree}`);
    expect(existsSync(target)).toBe(false);
  });

  it("fails closed when the pinned commit does not exist in the repository, leaving no cache", async () => {
    const target = freshTarget();

    await expect(
      ensurePinnedRepository(manifestFor({ commit: "f".repeat(40) }), target),
    ).rejects.toThrow(/demo/);
    expect(existsSync(target)).toBe(false);
  });

  it("refuses an unpinned manifest before touching the file system", async () => {
    const target = freshTarget();

    await expect(ensurePinnedRepository(manifestFor({ commit: undefined, tree: undefined }), target)).rejects.toThrow(
      /40-hex commit/,
    );
    expect(existsSync(target)).toBe(false);
  });
});
