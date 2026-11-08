import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { FileArtifact } from "@contracts/discovery";
import { ModuleResolver, type WorkspacePackage } from "@graph/module-resolver";
import { loadWorkspacePackages } from "@graph/workspace-loader";

/** S3: workspace packages resolve by name to their source, without node_modules or network. */

const files = (paths: readonly string[]): FileArtifact[] => paths.map((path) => ({ id: path, path, language: path.endsWith(".json") ? "json" : "typescript", size: 1 }));

describe("S3 workspace package resolution", () => {
  const known = new Set([
    "packages/util/src/index.ts", "packages/util/src/errors.ts", "packages/util/src/deep/a.ts",
    "packages/plain/index.js", "packages/plain/lib/helper.js", "packages/main-only/lib/entry.js",
    "packages/built/build/index.js",
  ]);
  const packages: Readonly<Record<string, WorkspacePackage>> = {
    "@acme/util": { root: "packages/util", exports: { ".": { source: "./src/index.ts", types: "./build/index.d.ts", import: "./build/index.js" }, "./errors": { source: "./src/errors.ts" }, "./deep/*": "./src/deep/*.ts" } },
    plain: { root: "packages/plain" },
    "main-only": { root: "packages/main-only", main: "lib/entry.js" },
    built: { root: "packages/built", exports: { ".": { types: "./build/index.d.ts", default: "./build/index.js" } } },
    escape: { root: "packages/escape", exports: "../util/src/index.ts" },
    missing: { root: "packages/missing", exports: { ".": { import: "./dist/index.js" } } },
  };
  const resolver = new ModuleResolver({ packages });
  const resolve = (specifier: string, importer = "apps/web/src/main.ts") => resolver.resolve(importer, specifier, known).resolvedPath;

  it("resolves a package's root and subpath exports to their source condition", () => {
    expect(resolve("@acme/util")).toBe("packages/util/src/index.ts");
    expect(resolve("@acme/util/errors")).toBe("packages/util/src/errors.ts");
    expect(resolve("@acme/util/deep/a")).toBe("packages/util/src/deep/a.ts");
  });

  it("refuses subpaths an exports map does not export", () => {
    expect(resolve("@acme/util/src/index.ts")).toBeNull();
  });

  it("without exports, uses main, then the root index, and plain subpaths", () => {
    expect(resolve("plain")).toBe("packages/plain/index.js");
    expect(resolve("plain/lib/helper")).toBe("packages/plain/lib/helper.js");
    expect(resolve("main-only")).toBe("packages/main-only/lib/entry.js");
  });

  it("falls through conditions to a target that exists, and never past the package root", () => {
    expect(resolve("built")).toBe("packages/built/build/index.js");
    expect(resolve("escape")).toBeNull();
    expect(resolve("missing")).toBeNull();
  });

  it("leaves unknown packages, built-ins and relative paths as before", () => {
    expect(resolve("express")).toBeNull();
    expect(resolve("node:fs")).toBeNull();
    expect(resolve("@acme/other")).toBeNull();
    expect(resolver.resolve("packages/plain/index.js", "./lib/helper", known).resolvedPath).toBe("packages/plain/lib/helper.js");
  });
});

describe("S3 workspace loader", () => {
  let root: string;
  afterEach(async () => { if (root !== undefined) await rm(root, { recursive: true, force: true }); });

  async function project(entries: Readonly<Record<string, string>>): Promise<FileArtifact[]> {
    root = await mkdtemp(join(tmpdir(), "legacy-exodus-workspace-"));
    for (const [path, content] of Object.entries(entries)) {
      await mkdir(join(root, dirname(path)), { recursive: true });
      await writeFile(join(root, path), content);
    }
    return files(Object.keys(entries));
  }
  const manifest = (fields: Record<string, unknown>) => JSON.stringify(fields);

  it("reads npm and yarn workspaces, globs and negations", async () => {
    const discovered = await project({
      "package.json": manifest({ name: "root", workspaces: ["packages/*", "tools/**", "!packages/skip"] }),
      "packages/a/package.json": manifest({ name: "@x/a", main: "index.js" }),
      "packages/skip/package.json": manifest({ name: "@x/skip" }),
      "tools/deep/b/package.json": manifest({ name: "@x/b", exports: { ".": "./src/index.ts" } }),
      "other/c/package.json": manifest({ name: "@x/c" }),
    });
    const packages = await loadWorkspacePackages(root, discovered);
    expect(Object.keys(packages).sort()).toEqual(["@x/a", "@x/b"]);
    expect(packages["@x/a"]).toEqual({ root: "packages/a", main: "index.js" });
    expect(packages["@x/b"]).toEqual({ root: "tools/deep/b", exports: { ".": "./src/index.ts" } });
  });

  it("reads yarn's { packages } form and pnpm-workspace.yaml", async () => {
    const yarn = await project({
      "package.json": manifest({ workspaces: { packages: ["libs/*"] } }),
      "libs/a/package.json": manifest({ name: "a" }),
    });
    expect(Object.keys(await loadWorkspacePackages(root, yarn))).toEqual(["a"]);
    await rm(root, { recursive: true, force: true });
    const pnpm = await project({
      "package.json": manifest({ name: "root" }),
      "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n  - \"libs/**\"\n  - '!libs/_template'\n\nother: 1\n",
      "apps/web/package.json": manifest({ name: "web" }),
      "libs/x/y/package.json": manifest({ name: "y" }),
      "libs/_template/package.json": manifest({ name: "template" }),
    });
    expect(Object.keys(await loadWorkspacePackages(root, pnpm)).sort()).toEqual(["web", "y"]);
  });

  it("leaves a name two packages claim unresolved, and skips unreadable manifests", async () => {
    const discovered = await project({
      "package.json": manifest({ workspaces: ["p/*"] }),
      "p/one/package.json": manifest({ name: "dup" }),
      "p/two/package.json": manifest({ name: "dup" }),
      "p/bad/package.json": "{ not json",
      "p/ok/package.json": manifest({ name: "ok" }),
    });
    expect(Object.keys(await loadWorkspacePackages(root, discovered))).toEqual(["ok"]);
  });

  it("has no packages without a workspace declaration", async () => {
    const discovered = await project({ "package.json": manifest({ name: "solo" }), "a/package.json": manifest({ name: "a" }) });
    expect(await loadWorkspacePackages(root, discovered)).toEqual({});
  });
});
