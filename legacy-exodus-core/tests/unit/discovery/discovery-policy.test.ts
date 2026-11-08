import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { isR01DispatchedFile } from "@contracts/discovery-projection";
import { FileScanner } from "@discovery/file-scanner";
import { ProjectDetector } from "@discovery/project-detector";

/** BA-15: discovery keeps to the project's authentic source, and says what it left out. */

let root: string | undefined;
afterEach(async () => { if (root !== undefined) await rm(root, { recursive: true, force: true }); root = undefined; });

async function project(entries: Readonly<Record<string, string>>): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "legacy-exodus-policy-"));
  for (const [path, content] of Object.entries(entries)) {
    await mkdir(join(root, dirname(path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

describe("BA-15 scanner policy", () => {
  it("applies nested .gitignore files below their directory and a root .legacyexodusignore", async () => {
    const path = await project({
      ".legacyexodusignore": "fixtures/\n",
      ".gitignore": "*.tmp\n",
      "packages/a/.gitignore": "generated/\n",
      "packages/a/src/index.ts": "export const a = 1;\n",
      "packages/a/generated/types.ts": "export type T = 1;\n",
      "packages/b/generated/kept.ts": "export const b = 1;\n",
      "fixtures/sample.js": "x();\n",
      "notes.tmp": "x\n",
    });
    const scan = await new FileScanner().scan(path);
    expect(scan.files.map((file) => file.path)).toEqual([
      ".gitignore", ".legacyexodusignore", "packages/a/.gitignore", "packages/a/src/index.ts", "packages/b/generated/kept.ts",
    ]);
    expect(scan.excludedPaths).toEqual([
      { path: "fixtures", kind: "directory", reason: "legacyexodusignore" },
      { path: "notes.tmp", kind: "file", reason: "gitignore" },
      { path: "packages/a/generated", kind: "directory", reason: "gitignore" },
    ]);
  });

  it("reports a symbolic link it does not follow, instead of leaving it out silently (NA-07)", async () => {
    const outside = await mkdtemp(join(tmpdir(), "legacy-exodus-outside-"));
    try {
      await writeFile(join(outside, "secret.js"), "export const secret = 1;\n");
      const path = await project({ "src/main.js": "export const main = 1;\n" });
      // A junction needs no privilege on Windows; elsewhere the type is ignored and a directory link is made.
      await symlink(outside, join(path, "src", "linked"), "junction");
      const scan = await new FileScanner().scan(path);
      expect(scan.files.map((file) => file.path)).toEqual(["src/main.js"]);
      expect(scan.excludedPaths).toEqual([{ path: "src/linked", kind: "link", reason: "symbolic-link" }]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("keeps files git tracks, as git does: .gitignore applies to untracked files only", async () => {
    const path = await project({
      ".gitignore": "config.*.json\nbuild/\n",
      ".legacyexodusignore": "secret.json\n",
      "config.development.json": "{}",
      "config.local.json": "{}",
      "build/kept.js": "export {};\n",
      "build/output.js": "export {};\n",
      "secret.json": "{}",
    });
    const tracked = new Set([".gitignore", ".legacyexodusignore", "config.development.json", "build/kept.js", "secret.json"]);
    const scan = await new FileScanner({ trackedFiles: async () => tracked }).scan(path);
    expect(scan.files.map((file) => file.path)).toEqual([".gitignore", ".legacyexodusignore", "build/kept.js", "config.development.json"]);
    expect(scan.excludedPaths).toEqual([
      { path: "build/output.js", kind: "file", reason: "gitignore" },
      { path: "config.local.json", kind: "file", reason: "gitignore" },
      { path: "secret.json", kind: "file", reason: "legacyexodusignore" },
    ]);
  });

  it("lists minified bundles as generated and does not dispatch them; similar names stay source", async () => {
    const path = await project({ "public/app.min.js": "!function(){}();\n", "src/admin.js": "export {};\n", "src/x.min.mjs": "export{};\n" });
    const files = (await new FileScanner().scan(path)).files;
    expect(files.map((file) => [file.path, file.fileKind, isR01DispatchedFile(file)])).toEqual([
      ["public/app.min.js", "generated", false],
      ["src/admin.js", "source", true],
      ["src/x.min.mjs", "generated", false],
    ]);
  });
});

describe("BA-15 project detection", () => {
  it("takes frameworks from manifests only, workspace packages included, never from directory names", async () => {
    const path = await project({
      "package.json": JSON.stringify({ name: "mono", workspaces: ["apps/*"], devDependencies: { typescript: "5" } }),
      "apps/api/package.json": JSON.stringify({ name: "api", dependencies: { express: "4" } }),
      "apps/web/package.json": JSON.stringify({ name: "web", dependencies: { react: "18" } }),
      "apps/web/src/components/button.tsx": "export {};\n",
      "legacy/controllers/users.js": "export {};\n",
    });
    const files = (await new FileScanner().scan(path)).files;
    const detection = await new ProjectDetector().detect(path, files);
    expect(detection.frameworks).toEqual([
      { name: "express", evidence: "workspace package.json dependency" },
      { name: "react", evidence: "workspace package.json dependency" },
    ]);
    expect(detection.dependencies.map((dependency) => [dependency.name, dependency.manifest ?? "(root)"])).toEqual([
      ["express", "apps/api/package.json"], ["react", "apps/web/package.json"], ["typescript", "(root)"],
    ]);
  });

  it("detects nothing from a components or controllers directory alone", async () => {
    const path = await project({ "package.json": JSON.stringify({ name: "plain" }), "components/a.js": "x;\n", "routes/b.js": "y;\n" });
    const files = (await new FileScanner().scan(path)).files;
    expect((await new ProjectDetector().detect(path, files)).frameworks).toEqual([]);
  });
});
