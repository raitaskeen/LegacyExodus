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
import { dirname, join } from "node:path";

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

// A checkout whose HEAD tree is the pinned tree can still hold edited or extra files, and the engine
// analyzes the working tree. Only the engine's own output directories may differ from the pinned tree.
describe("BA-20 / A6: working-tree integrity", () => {
  async function createSourceRepo(
    files: Readonly<Record<string, string>>,
  ): Promise<{ readonly dir: string; readonly commit: string; readonly tree: string }> {
    counter += 1;
    const dir = join(workRoot, `source-${counter}`);
    await mkdir(dir, { recursive: true });
    git(dir, "init", "--quiet");
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), content, "utf8");
    }
    git(dir, "add", "-A");
    git(dir, "commit", "--quiet", "-m", "pinned");
    const commit = git(dir, "rev-parse", "HEAD");
    return { dir, commit, tree: git(dir, "rev-parse", `${commit}^{tree}`) };
  }

  async function acquire(overrides: Partial<BenchmarkManifest> = {}): Promise<string> {
    const target = freshTarget();
    await ensurePinnedRepository(manifestFor(overrides), target);
    return target;
  }

  async function rejection(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
    } catch (error: unknown) {
      return error instanceof Error ? error.message : String(error);
    }
    throw new Error("expected the promise to reject");
  }

  const verify = (target: string, tree = source.first.tree): Promise<void> => verifyPinnedTree(target, tree, "demo");

  it("accepts a pristine checkout", async () => {
    const target = await acquire();

    await verify(target);
    expect(await ensurePinnedRepository(manifestFor(), target)).toBe("verified");
  });

  it("rejects an edited tracked file and names it, although HEAD still has the pinned tree", async () => {
    const target = await acquire();
    await writeFile(join(target, "lib.js"), "module.exports = 'edited';", "utf8");
    expect(git(target, "rev-parse", "HEAD^{tree}")).toBe(source.first.tree);

    const message = await rejection(verify(target));

    expect(message).toContain("demo");
    expect(message).toContain("M lib.js");
    expect(message).not.toContain("expected tree");
  });

  it("rejects a deleted tracked file and a staged edit", async () => {
    const deleted = await acquire();
    await rm(join(deleted, "lib.js"));
    expect(await rejection(verify(deleted))).toContain("D lib.js");

    const staged = await acquire();
    await writeFile(join(staged, "lib.js"), "module.exports = 'staged';", "utf8");
    git(staged, "add", "lib.js");
    expect(git(staged, "rev-parse", "HEAD^{tree}")).toBe(source.first.tree);
    expect(await rejection(verify(staged))).toContain("M lib.js");
  });

  it("rejects an untracked file, including one in a new directory", async () => {
    const top = await acquire();
    await writeFile(join(top, "extra.js"), "module.exports = 'extra';", "utf8");
    expect(await rejection(verify(top))).toContain("?? extra.js");

    const nested = await acquire();
    await mkdir(join(nested, "lib", "deep"), { recursive: true });
    await writeFile(join(nested, "lib", "deep", "extra.js"), "module.exports = 'extra';", "utf8");
    expect(await rejection(verify(nested))).toContain("?? lib/deep/extra.js");
  });

  it("accepts untracked engine output under .discovery/ and .legacy-exodus/", async () => {
    const target = await acquire();
    await mkdir(join(target, ".discovery", "nested"), { recursive: true });
    await writeFile(join(target, ".discovery", "x.json"), "{}", "utf8");
    await writeFile(join(target, ".discovery", "nested", "y.json"), "{}", "utf8");
    await mkdir(join(target, ".legacy-exodus"), { recursive: true });
    await writeFile(join(target, ".legacy-exodus", "state.json"), "{}", "utf8");

    await verify(target);
    expect(await ensurePinnedRepository(manifestFor(), target)).toBe("verified");
  });

  it("does not exempt look-alikes of the engine output directories", async () => {
    const lookAlikes: readonly string[] = [".discovery-old/x.json", "sub/.discovery/x.json", ".discoveryx", ".discovery"];
    for (const lookAlike of lookAlikes) {
      const target = await acquire();
      await mkdir(dirname(join(target, lookAlike)), { recursive: true });
      await writeFile(join(target, lookAlike), "{}", "utf8");

      expect(await rejection(verify(target))).toContain(`?? ${lookAlike}`);
    }
  });

  it("still reports a tracked file that lives inside an engine output directory", async () => {
    const tracked = await createSourceRepo({ "lib.js": "module.exports = 1;", ".discovery/x.json": "{\"tracked\":true}" });
    const overrides = { repository: tracked.dir, commit: tracked.commit, tree: tracked.tree };
    const target = await acquire(overrides);

    await writeFile(join(target, ".discovery", "untracked.json"), "{}", "utf8");
    await verify(target, tracked.tree);

    await writeFile(join(target, ".discovery", "x.json"), "{\"tracked\":false}", "utf8");
    expect(await rejection(verify(target, tracked.tree))).toContain("M .discovery/x.json");
  });

  it("reports ignored files, except ignored engine output", async () => {
    const ignoring = await createSourceRepo({ "lib.js": "module.exports = 1;", ".gitignore": "ignored.txt\n.discovery/\n" });
    const target = await acquire({ repository: ignoring.dir, commit: ignoring.commit, tree: ignoring.tree });

    await mkdir(join(target, ".discovery"), { recursive: true });
    await writeFile(join(target, ".discovery", "x.json"), "{}", "utf8");
    await verify(target, ignoring.tree);

    await writeFile(join(target, "ignored.txt"), "hidden from git status", "utf8");
    expect(await rejection(verify(target, ignoring.tree))).toContain("!! ignored.txt");
  });

  it("names at most the first 10 changed paths and counts the rest", async () => {
    const target = await acquire();
    for (let i = 1; i <= 12; i++) {
      await writeFile(join(target, `f${String(i).padStart(2, "0")}.txt`), "x", "utf8");
    }

    const message = await rejection(verify(target));

    for (let i = 1; i <= 10; i++) expect(message).toContain(`f${String(i).padStart(2, "0")}.txt`);
    expect(message).not.toContain("f11.txt");
    expect(message).not.toContain("f12.txt");
    expect(message).toContain("12 changed paths");
    expect(message).toContain("and 2 more");
  });

  it("fails closed on reuse of a dirty cache, and keeps it as evidence", async () => {
    const target = await acquire();
    await writeFile(join(target, "lib.js"), "module.exports = 'edited';", "utf8");

    expect(await rejection(ensurePinnedRepository(manifestFor(), target))).toContain("M lib.js");
    expect(await readFile(join(target, "lib.js"), "utf8")).toBe("module.exports = 'edited';");
  });
});
