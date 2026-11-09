import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { FileArtifact } from "@contracts/discovery";
import { ModuleResolver } from "@graph/module-resolver";
import { loadDirectoryMains } from "@graph/workspace-loader";

/** A required directory loads as Node loads it: as a file, then through its package.json `main`, then its index. */

describe("relative directory resolution through package.json main", () => {
  const known = new Set([
    "fastify.js", "test/t.js",
    "lib.js", "lib/package.json", "lib/index.js",
    "pkg/package.json", "pkg/entry.js", "pkg/index.js",
    "gone/package.json", "gone/index.js",
    "out/package.json", "out/index.js", "secret.js",
    "plain/index.js",
  ]);
  const resolver = new ModuleResolver({
    directoryMains: { ".": "fastify.js", lib: "other.js", pkg: "entry", gone: "dist/missing.js", out: "../secret.js" },
  });
  const resolve = (specifier: string, importer = "test/t.js") => resolver.resolve(importer, specifier, known).resolvedPath;

  it("follows main for the package root, as `require('..')` in its tests does", () => {
    expect(resolve("..")).toBe("fastify.js");
  });

  it("prefers a same-named file to the directory", () => {
    expect(resolve("./lib", "main.js")).toBe("lib.js");
  });

  it("prefers main to the directory's index, with the usual extensions", () => {
    expect(resolve("./pkg", "main.js")).toBe("pkg/entry.js");
  });

  it("falls back to the index when main names no file, and never follows a main outside its directory", () => {
    expect(resolve("./gone", "main.js")).toBe("gone/index.js");
    expect(resolve("./out", "main.js")).toBe("out/index.js");
  });

  it("is unchanged for a directory without a main", () => {
    expect(resolve("./plain", "main.js")).toBe("plain/index.js");
    expect(new ModuleResolver().resolve("test/t.js", "..", known).resolvedPath).toBeNull();
  });
});

describe("directory main loader", () => {
  let root: string | undefined;
  afterEach(async () => { if (root !== undefined) await rm(root, { recursive: true, force: true }); });

  it("reads main from every inventoried package.json, skipping unreadable ones and those without main", async () => {
    root = await mkdtemp(join(tmpdir(), "legacy-exodus-directory-main-"));
    const entries: Record<string, string> = {
      "package.json": JSON.stringify({ name: "root", main: "fastify.js" }),
      "packages/a/package.json": JSON.stringify({ name: "a", main: "./lib/a.js" }),
      "packages/b/package.json": JSON.stringify({ name: "b" }),
      "packages/c/package.json": "{ not json",
      "packages/d/package.json": JSON.stringify({ name: "d", main: 7 }),
    };
    for (const [path, content] of Object.entries(entries)) {
      await mkdir(join(root, dirname(path)), { recursive: true });
      await writeFile(join(root, path), content);
    }
    // A manifest the inventory does not list is not read.
    await mkdir(join(root, "hidden"), { recursive: true });
    await writeFile(join(root, "hidden/package.json"), JSON.stringify({ main: "x.js" }));
    const files: FileArtifact[] = Object.keys(entries).map((path) => ({ id: path, path, language: "json", size: 1 }));

    expect(await loadDirectoryMains(root, files)).toEqual({ ".": "fastify.js", "packages/a": "./lib/a.js" });
  });
});
