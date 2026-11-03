import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { FileScanner } from "@discovery/file-scanner";

/** Review of #227: git is run safely on an untrusted repository, and git's own ignore rules are honoured. */

let root: string | undefined;
afterEach(async () => { if (root !== undefined) await rm(root, { recursive: true, force: true }); root = undefined; });

async function repository(entries: Readonly<Record<string, string>>, commit: readonly string[]): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "legacy-exodus-review-"));
  for (const [path, content] of Object.entries(entries)) {
    await mkdir(join(root, dirname(path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  const git = (...args: string[]): void => { execFileSync("git", args, { cwd: root, stdio: "ignore" }); };
  git("init", "-q");
  git("config", "core.autocrlf", "false");
  if (commit.length > 0) { git("add", ...commit); git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"); }
  return root;
}

describe("git on an analyzed repository", () => {
  it("never runs a program the repository's own config names (core.fsmonitor)", async () => {
    const path = await repository({ "index.js": "export {};\n" }, ["index.js"]);
    const marker = join(path, "ran");
    const hook = join(path, "hook.sh");
    await writeFile(hook, `#!/bin/sh\necho ran > "${marker.replaceAll("\\", "/")}"\nexit 1\n`);
    await chmod(hook, 0o755);
    execFileSync("git", ["config", "core.fsmonitor", hook.replaceAll("\\", "/")], { cwd: path });
    const scan = await new FileScanner().scan(path);
    expect(scan.files.map((file) => file.path)).toContain("index.js");
    await expect(stat(marker)).rejects.toThrow();
  });
});

describe("git's ignore rules around the project", () => {
  it("applies .git/info/exclude and a .gitignore above a project in a subdirectory", async () => {
    const path = await repository({
      ".gitignore": "*.generated.js\n/services/api/tmp/\n",
      "services/api/index.js": "export {};\n",
      "services/api/model.generated.js": "export {};\n",
      "services/api/scratch.js": "export {};\n",
      "services/api/tmp/a.js": "export {};\n",
    }, [".gitignore", "services/api/index.js"]);
    await writeFile(join(path, ".git", "info", "exclude"), "scratch.js\n");
    const scan = await new FileScanner().scan(join(path, "services", "api"));
    expect(scan.files.map((file) => file.path)).toEqual(["index.js"]);
    expect(scan.excludedPaths).toEqual([
      { path: "model.generated.js", kind: "file", reason: "gitignore" },
      { path: "scratch.js", kind: "file", reason: "gitignore" },
      { path: "tmp", kind: "directory", reason: "gitignore" },
    ]);
  });

  it("matches patterns regardless of case when git does (core.ignorecase)", async () => {
    root = await mkdtemp(join(tmpdir(), "legacy-exodus-review-"));
    await mkdir(join(root, "Logs"), { recursive: true });
    await writeFile(join(root, ".gitignore"), "logs/\n");
    await writeFile(join(root, "Logs", "debug.js"), "x;\n");
    await writeFile(join(root, "index.js"), "x;\n");
    const scanner = (ignoreCase: boolean) => new FileScanner({ trackedFiles: async () => undefined, gitIgnoreContext: async () => ({ ignoreCase, outer: [] }) });
    expect((await scanner(true).scan(root)).files.map((file) => file.path)).toEqual([".gitignore", "index.js"]);
    expect((await scanner(false).scan(root)).files.map((file) => file.path)).toEqual([".gitignore", "Logs/debug.js", "index.js"]);
  });
});
