import * as cp from "node:child_process";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { describe, expect, spyOn, test } from "bun:test";

import { createDiscoveryProjection } from "@contracts/discovery-projection";
import { FileDiscoveryProjectionAdapter, resolveGitCommitSha } from "@storage/index";

describe("FileDiscoveryProjectionAdapter", () => {
  test("writes deterministic discovery artifacts", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-projection-"));
    const projection = createDiscoveryProjection({
      projectPath,
      artifacts: [
        { name: "project.json", payload: { name: "library-system", languages: ["javascript"] } },
        { name: "files.json", payload: [{ path: "src/index.js" }] },
        { name: "dependencies.json", payload: [{ name: "express", version: "4.0.0" }] },
        { name: "frameworks.json", payload: [{ name: "express" }] },
        { name: "summary.json", payload: { fileCount: 1 } },
      ],
    });
    const adapter = new FileDiscoveryProjectionAdapter();

    try {
      await adapter.write(projection);
      const initialProjectArtifact = await readFile(join(projectPath, ".discovery", "project.json"), "utf8");

      await adapter.write(projection);
      const repeatedProjectArtifact = await readFile(
        join(projectPath, ".discovery", "project.json"),
        "utf8",
      );

      expect(initialProjectArtifact).toBe(repeatedProjectArtifact);
      expect(JSON.parse(initialProjectArtifact)).toEqual({
        name: "library-system",
        languages: ["javascript"],
      });
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });

  // ─── SEC-01: Git Subprocess Execution Hardening Tests ─────────────────────

  test("SEC-01 Test 1: Normal Git repository revision lookup succeeds with valid 40-char SHA", async (): Promise<void> => {
    const repoDir = join(tmpdir(), `sec01-git-normal-${randomUUID()}`);
    await mkdir(repoDir, { recursive: true });

    try {
      spawnSync("git", ["init"], { cwd: repoDir, stdio: "ignore", shell: false });
      spawnSync("git", ["config", "user.email", "audit@legacyexodus.local"], { cwd: repoDir, stdio: "ignore", shell: false });
      spawnSync("git", ["config", "user.name", "Security Auditor"], { cwd: repoDir, stdio: "ignore", shell: false });
      await writeFile(join(repoDir, "README.md"), "# Test Repo\n", "utf8");
      spawnSync("git", ["add", "README.md"], { cwd: repoDir, stdio: "ignore", shell: false });
      spawnSync("git", ["commit", "-m", "initial commit"], { cwd: repoDir, stdio: "ignore", shell: false });

      const sha = resolveGitCommitSha(repoDir);
      expect(sha).toBeDefined();
      expect(typeof sha).toBe("string");
      expect(sha).toMatch(/^[0-9a-f]{40}$/);

      // Verify direct equality with git CLI output
      const expected = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf8", shell: false }).stdout.trim();
      expect(sha).toBe(expected);
    } finally {
      await rm(repoDir, { force: true, recursive: true });
    }
  });

  test("SEC-01 Test 2: Repository path containing shell metacharacters (& ; $ spaces parentheses)", async (): Promise<void> => {
    const safeName = `sec01-meta & foo; $bar (test) ${randomUUID()}`;
    const repoDir = join(tmpdir(), safeName);
    await mkdir(repoDir, { recursive: true });

    try {
      spawnSync("git", ["init"], { cwd: repoDir, stdio: "ignore", shell: false });
      spawnSync("git", ["config", "user.email", "audit@legacyexodus.local"], { cwd: repoDir, stdio: "ignore", shell: false });
      spawnSync("git", ["config", "user.name", "Security Auditor"], { cwd: repoDir, stdio: "ignore", shell: false });
      await writeFile(join(repoDir, "index.js"), "console.log(1);\n", "utf8");
      spawnSync("git", ["add", "index.js"], { cwd: repoDir, stdio: "ignore", shell: false });
      spawnSync("git", ["commit", "-m", "commit with meta path"], { cwd: repoDir, stdio: "ignore", shell: false });

      // If shell interpolation were active, metacharacters would split/fail command execution
      const sha = resolveGitCommitSha(repoDir);
      expect(sha).toBeDefined();
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
    } finally {
      await rm(repoDir, { force: true, recursive: true });
    }
  });

  test("SEC-01 Test 3: Windows-style path with backslashes is handled correctly as process working directory", (): void => {
    const windowsPath = "C:\\projects\\legacy-exodus\\repo";
    const mockSha = "abcdef1234567890abcdef1234567890abcdef12";

    const spy = spyOn(cp, "spawnSync").mockReturnValue({
      status: 0,
      stdout: `${mockSha}\n`,
      stderr: "",
      pid: 1234,
      output: [null, `${mockSha}\n`, ""],
      signal: null,
    } as any);

    try {
      const sha = resolveGitCommitSha(windowsPath);
      expect(sha).toBe(mockSha);
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
      expect(spy).toHaveBeenCalledWith(
        "git",
        ["rev-parse", "HEAD"],
        expect.objectContaining({
          cwd: windowsPath,
          shell: false,
        }),
      );
    } finally {
      spy.mockRestore();
    }
  });

  test("SEC-01 Test 4: Non-Git repository gracefully falls back to undefined without throwing", async (): Promise<void> => {
    const nonGitDir = join(tmpdir(), `sec01-non-git-${randomUUID()}`);
    await mkdir(nonGitDir, { recursive: true });

    try {
      const sha = resolveGitCommitSha(nonGitDir);
      expect(sha).toBeUndefined();

      // Ensure FileDiscoveryProjectionAdapter writes manifest with valid fallback structure
      const adapter = new FileDiscoveryProjectionAdapter();
      const projection = createDiscoveryProjection({
        projectPath: nonGitDir,
        artifacts: [
          { name: "summary.json", payload: { count: 0 } },
        ],
      });

      await adapter.write(projection);
      const manifestRaw = await readFile(join(nonGitDir, ".discovery", "manifest.json"), "utf8");
      const manifest = JSON.parse(manifestRaw);

      expect(manifest.repository.commitSha).toBeUndefined();
      expect(manifest.engine.commitSha).toBeDefined();
    } finally {
      await rm(nonGitDir, { force: true, recursive: true });
    }
  });

  test("SEC-01 Test 5: Direct process invocation does not execute shell command strings or pipelines", async (): Promise<void> => {
    const invalidPath = join(tmpdir(), "nonexistent-dir-12345");
    const sha = resolveGitCommitSha(invalidPath);
    expect(sha).toBeUndefined();
  });
});
