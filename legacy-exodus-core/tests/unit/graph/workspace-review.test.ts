import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { loadWorkspacePackages } from "@graph/workspace-loader";
import { ModuleResolver } from "@graph/module-resolver";

/** Review of #226: workspace declarations git hosts accept, and packages whose entry is build output. */

let root: string | undefined;
afterEach(async () => { if (root !== undefined) await rm(root, { recursive: true, force: true }); root = undefined; });

async function monorepo(entries: Readonly<Record<string, string>>): Promise<{ readonly path: string; readonly files: { path: string }[] }> {
  root = await mkdtemp(join(tmpdir(), "legacy-exodus-workspace-"));
  for (const [path, content] of Object.entries(entries)) {
    await mkdir(join(root, dirname(path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return { path: root, files: Object.keys(entries).map((path) => ({ path })) };
}
const manifest = (fields: Record<string, unknown>): string => JSON.stringify(fields);

describe("workspace declarations", () => {
  it("reads a pnpm flow-style package list", async () => {
    const { path, files } = await monorepo({
      "pnpm-workspace.yaml": "packages: ['apps/*', \"libs/*\"] # all\n",
      "apps/web/package.json": manifest({ name: "web" }),
      "libs/core/package.json": manifest({ name: "@acme/core" }),
    });
    expect(Object.keys(await loadWorkspacePackages(path, files as any)).sort()).toEqual(["@acme/core", "web"]);
  });

  it("expands brace sets in workspace globs", async () => {
    const { path, files } = await monorepo({
      "package.json": manifest({ workspaces: ["{apps,libs}/*", "!libs/{legacy,old}"] }),
      "apps/web/package.json": manifest({ name: "web" }),
      "libs/core/package.json": manifest({ name: "core" }),
      "libs/legacy/package.json": manifest({ name: "legacy" }),
    });
    expect(Object.keys(await loadWorkspacePackages(path, files as any)).sort()).toEqual(["core", "web"]);
  });
});

describe("entries in build output", () => {
  it("resolve to the package's own source when the build is not in the repository", async () => {
    const { path, files } = await monorepo({
      "package.json": manifest({ workspaces: ["packages/*"] }),
      "packages/lib/package.json": manifest({ name: "lib", main: "build/index.js", exports: { ".": { require: "./build/index.js" }, "./util": "./build/util.cjs" } }),
      "packages/lib/src/index.ts": "export const a = 1;\n",
      "packages/lib/src/util.ts": "export const b = 1;\n",
      "packages/ui/package.json": manifest({ name: "ui", exports: { ".": "./dist/ui.umd.js" } }),
      "packages/ui/src/index.tsx": "export const c = 1;\n",
      "packages/old/package.json": manifest({ name: "old", main: "lib/main.js" }),
      "packages/old/src/main.js": "module.exports = 1;\n",
    });
    const resolver = new ModuleResolver({ packages: await loadWorkspacePackages(path, files as any) });
    const known = new Set(files.map((file) => file.path));
    const resolve = (specifier: string) => resolver.resolve("app.ts", specifier, known).resolvedPath;
    expect(resolve("lib")).toBe("packages/lib/src/index.ts");
    expect(resolve("lib/util")).toBe("packages/lib/src/util.ts");
    expect(resolve("ui")).toBe("packages/ui/src/index.tsx");
    expect(resolve("old")).toBe("packages/old/src/main.js");
  });
});
