/**
 * BA-20 / A6 - Benchmark corpora are pinned by content, not by a mutable tag.
 *
 * A manifest's `revision` is a git tag. Tags can be moved and nothing checked the
 * downloaded content, so ground-truth tests could silently run on different code.
 * Every manifest that names a `repository` must therefore also record the exact
 * `commit` the tag resolved to and the git `tree` of that commit. Acquisition and
 * every reuse of a cached checkout verify the tree (see corpus-acquisition.test.ts).
 */

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { CORPUS_DIR } from "../../../benchmarks/paths";
import type { BenchmarkManifest } from "../../../benchmarks/types";

const GIT_SHA = /^[0-9a-f]{40}$/;

// The external corpora that existed when the pins were introduced. Listing them keeps the
// well-formedness checks below from passing vacuously if manifest discovery ever breaks.
const EXTERNAL_CORPORA = ["cookie-parser", "debug", "express", "express-session", "fastify", "ghost", "ms"];

interface LoadedManifest {
  readonly file: string;
  readonly manifest: BenchmarkManifest;
}

function loadManifests(): readonly LoadedManifest[] {
  const loaded: LoadedManifest[] = [];
  for (const tier of readdirSync(CORPUS_DIR, { withFileTypes: true })) {
    if (!tier.isDirectory()) continue;
    for (const file of readdirSync(join(CORPUS_DIR, tier.name)).sort()) {
      if (!file.endsWith(".json")) continue;
      const path = join(CORPUS_DIR, tier.name, file);
      loaded.push({ file: `${tier.name}/${file}`, manifest: JSON.parse(readFileSync(path, "utf8")) as BenchmarkManifest });
    }
  }
  return loaded;
}

describe("BA-20 / A6: corpus manifests pin commit and tree", () => {
  const manifests = loadManifests();
  const external = manifests.filter((m) => m.manifest.repository !== undefined);

  it("discovers every external corpus manifest", () => {
    expect(external.map((m) => m.manifest.name).sort()).toEqual(EXTERNAL_CORPORA);
  });

  it("gives every manifest with a repository a readable revision, a 40-hex commit and a 40-hex tree", () => {
    const problems: string[] = [];
    for (const { file, manifest } of external) {
      if (typeof manifest.revision !== "string" || manifest.revision.length === 0) {
        problems.push(`${file}: revision is missing`);
      }
      if (typeof manifest.commit !== "string" || !GIT_SHA.test(manifest.commit)) {
        problems.push(`${file}: commit is not a 40-hex SHA (${JSON.stringify(manifest.commit)})`);
      }
      if (typeof manifest.tree !== "string" || !GIT_SHA.test(manifest.tree)) {
        problems.push(`${file}: tree is not a 40-hex SHA (${JSON.stringify(manifest.tree)})`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("pins distinct content for distinct corpora and never confuses a commit with its tree", () => {
    const commits = external.map((m) => m.manifest.commit);
    const trees = external.map((m) => m.manifest.tree);
    expect(new Set(commits).size).toBe(external.length);
    expect(new Set(trees).size).toBe(external.length);
    for (const { manifest } of external) {
      expect(manifest.commit).not.toBe(manifest.tree);
    }
  });
});
