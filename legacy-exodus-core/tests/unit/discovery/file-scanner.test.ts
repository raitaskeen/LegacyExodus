import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, test } from "bun:test";

import { FileScanner } from "@discovery/index";

describe("FileScanner", () => {
  test("inventories files in deterministic order and ignores generated directories", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-scan-"));

    try {
      await mkdir(join(projectPath, "controllers"));
      await mkdir(join(projectPath, "node_modules", "ignored"), { recursive: true });
      await writeFile(join(projectPath, "controllers", "books.js"), "export {};", "utf8");
      await writeFile(join(projectPath, "package.json"), "{}", "utf8");
      await writeFile(join(projectPath, "node_modules", "ignored", "index.js"), "", "utf8");

      const { files, enumerationFailures } = await new FileScanner().scan(projectPath);

      expect(files.map((file) => file.path)).toEqual(["controllers/books.js", "package.json"]);
      expect(files[0]?.language).toBe("javascript");
      expect(files[0]?.fileKind).toBe("source");
      expect(files[1]?.language).toBe("json");
      expect(files[1]?.fileKind).toBe("manifest");
      expect(enumerationFailures).toEqual([]);
      expect(Object.isFrozen(files)).toBe(true);
      expect(Object.isFrozen(enumerationFailures)).toBe(true);
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });

  test("classifies supported repository file kinds without claiming parser support", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-kinds-"));
    try {
      for (const name of ["README.md", "component.mdx", "page.html", "style.css", "config.yaml", "main.rs", "Dockerfile", ".gitignore", "tsconfig.json", "unknown.asset", "LICENSE"]) {
        await writeFile(join(projectPath, name), "", "utf8");
      }
      const { files, enumerationFailures } = await new FileScanner().scan(projectPath);
      const byPath = new Map(files.map((file) => [file.path, file]));
      expect(enumerationFailures).toEqual([]);
      expect(byPath.get("README.md")).toMatchObject({ language: "markdown", fileKind: "documentation" });
      expect(byPath.get("page.html")).toMatchObject({ language: "html", fileKind: "markup" });
      expect(byPath.get("style.css")).toMatchObject({ language: "css", fileKind: "stylesheet" });
      expect(byPath.get("config.yaml")).toMatchObject({ language: "yaml", fileKind: "data" });
      expect(byPath.get("main.rs")).toMatchObject({ language: "rust", fileKind: "source" });
      expect(byPath.get("Dockerfile")).toMatchObject({ language: "dockerfile", fileKind: "container" });
      expect(byPath.get(".gitignore")).toMatchObject({ language: "gitignore", fileKind: "configuration" });
      expect(byPath.get("tsconfig.json")).toMatchObject({ language: "json", fileKind: "configuration" });
      expect(byPath.get("unknown.asset")).toMatchObject({ language: "unknown", fileKind: "unknown" });
      expect(byPath.get("LICENSE")).toMatchObject({ language: "unknown", fileKind: "unknown" });
    } finally { await rm(projectPath, { force: true, recursive: true }); }
  });

  test("accurately classifies all source languages and distinguishes genuine non-source and unclassified files", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-sources-"));
    try {
      const fixtures = [
        // Case A: Known unsupported source
        "service.rs",
        // Case B: Previously unrecognized source-like extensions
        "Main.kt", "App.vue", "widget.swift", "Program.scala", "app.dart", "native.cpp", "header.hpp", "script.sh", "module.zig",
        // Case C: Real documentation non-source
        "README.md", "notes.txt",
        // Case D: Stylesheet non-source
        "styles.css", "theme.scss",
        // Case E: Manifest / Config / Data non-source
        "package.json", "data.json", "schema.sql",
        // Case F: Unknown / Unclassified file
        "foo.data", "backup.tmp",
      ];
      for (const name of fixtures) {
        await writeFile(join(projectPath, name), "", "utf8");
      }
      const { files, enumerationFailures } = await new FileScanner().scan(projectPath);
      const byPath = new Map(files.map((file) => [file.path, file]));

      expect(enumerationFailures).toEqual([]);

      // Case A
      expect(byPath.get("service.rs")).toMatchObject({ language: "rust", fileKind: "source" });

      // Case B
      expect(byPath.get("Main.kt")).toMatchObject({ language: "kotlin", fileKind: "source" });
      expect(byPath.get("App.vue")).toMatchObject({ language: "vue", fileKind: "source" });
      expect(byPath.get("widget.swift")).toMatchObject({ language: "swift", fileKind: "source" });
      expect(byPath.get("Program.scala")).toMatchObject({ language: "scala", fileKind: "source" });
      expect(byPath.get("app.dart")).toMatchObject({ language: "dart", fileKind: "source" });
      expect(byPath.get("native.cpp")).toMatchObject({ language: "cpp", fileKind: "source" });
      expect(byPath.get("header.hpp")).toMatchObject({ language: "cpp", fileKind: "source" });
      expect(byPath.get("script.sh")).toMatchObject({ language: "shell", fileKind: "source" });
      expect(byPath.get("module.zig")).toMatchObject({ language: "zig", fileKind: "source" });

      // Case C
      expect(byPath.get("README.md")).toMatchObject({ language: "markdown", fileKind: "documentation" });
      expect(byPath.get("notes.txt")).toMatchObject({ language: "text", fileKind: "documentation" });

      // Case D
      expect(byPath.get("styles.css")).toMatchObject({ language: "css", fileKind: "stylesheet" });
      expect(byPath.get("theme.scss")).toMatchObject({ language: "scss", fileKind: "stylesheet" });

      // Case E
      expect(byPath.get("package.json")).toMatchObject({ language: "json", fileKind: "manifest" });
      expect(byPath.get("data.json")).toMatchObject({ language: "json", fileKind: "data" });
      expect(byPath.get("schema.sql")).toMatchObject({ language: "sql", fileKind: "database-schema" });

      // Case F
      expect(byPath.get("foo.data")).toMatchObject({ language: "unknown", fileKind: "unknown" });
      expect(byPath.get("backup.tmp")).toMatchObject({ language: "unknown", fileKind: "unknown" });
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });

  test("safely skips symbolic links and junctions to prevent traversal cycles and duplicate discovery", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-symlinks-"));
    try {
      await mkdir(join(projectPath, "src"));
      await writeFile(join(projectPath, "src", "index.js"), "export const ok = true;", "utf8");

      // Attempt to create a directory symlink or junction pointing to src/
      try {
        await symlink(join(projectPath, "src"), join(projectPath, "linked_src"), "junction");
      } catch {
        try {
          await symlink(join(projectPath, "src"), join(projectPath, "linked_src"), "dir");
        } catch {
          // Fallback for non-privileged test environments
        }
      }

      const { files, enumerationFailures } = await new FileScanner().scan(projectPath);
      const paths = files.map((file) => file.path);

      // Only the real file is discovered; the symlink/junction is excluded
      expect(paths).toEqual(["src/index.js"]);
      expect(files[0]?.fileKind).toBe("source");
      expect(files[0]?.language).toBe("javascript");
      expect(enumerationFailures).toEqual([]);
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });

  test("Test 1: isolates directory read failure without crashing, records failure, and continues with reachable siblings", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-dir-failure-"));
    try {
      await mkdir(join(projectPath, "readable_a"));
      await mkdir(join(projectPath, "unreadable_dir"));
      await mkdir(join(projectPath, "readable_b"));
      await writeFile(join(projectPath, "readable_a", "file1.js"), "export const a = 1;", "utf8");
      await writeFile(join(projectPath, "readable_b", "file2.js"), "export const b = 2;", "utf8");

      const scanner = new FileScanner({
        readdir: (async (path: string, options: any) => {
          if (resolve(path).includes("unreadable_dir")) {
            const err = new Error("Permission denied") as any;
            err.code = "EACCES";
            throw err;
          }
          return readdir(path, options);
        }) as typeof readdir,
      });

      const { files, enumerationFailures } = await scanner.scan(projectPath);

      expect(files.map((f) => f.path)).toEqual(["readable_a/file1.js", "readable_b/file2.js"]);
      expect(enumerationFailures).toHaveLength(1);
      expect(enumerationFailures[0]).toMatchObject({
        path: "unreadable_dir",
        kind: "directory-read",
        code: "EACCES",
      });
      expect(Object.isFrozen(enumerationFailures[0])).toBe(true);
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });

  test("Test 2: isolates per-file stat failure without crashing and continues scanning sibling files", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-stat-failure-"));
    try {
      await writeFile(join(projectPath, "good1.js"), "export const g1 = 1;", "utf8");
      await writeFile(join(projectPath, "locked.bin"), "data", "utf8");
      await writeFile(join(projectPath, "good2.js"), "export const g2 = 2;", "utf8");

      const scanner = new FileScanner({
        stat: (async (path: string) => {
          if (resolve(path).includes("locked.bin")) {
            const err = new Error("Permission denied") as any;
            err.code = "EPERM";
            throw err;
          }
          return stat(path);
        }) as typeof stat,
      });

      const { files, enumerationFailures } = await scanner.scan(projectPath);

      expect(files.map((f) => f.path)).toEqual(["good1.js", "good2.js"]);
      expect(enumerationFailures).toHaveLength(1);
      expect(enumerationFailures[0]).toMatchObject({
        path: "locked.bin",
        kind: "entry-stat",
        code: "EPERM",
      });
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });

  test("Test 3: handles disappearing file / TOCTOU race condition without aborting discovery", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-toctou-"));
    try {
      await writeFile(join(projectPath, "existing.js"), "export const ok = true;", "utf8");
      await writeFile(join(projectPath, "disappearing.tmp"), "temp", "utf8");

      const scanner = new FileScanner({
        stat: (async (path: string) => {
          if (resolve(path).includes("disappearing.tmp")) {
            const err = new Error("No such file or directory") as any;
            err.code = "ENOENT";
            throw err;
          }
          return stat(path);
        }) as typeof stat,
      });

      const { files, enumerationFailures } = await scanner.scan(projectPath);

      expect(files.map((f) => f.path)).toEqual(["existing.js"]);
      expect(enumerationFailures).toHaveLength(1);
      expect(enumerationFailures[0]).toMatchObject({
        path: "disappearing.tmp",
        kind: "entry-stat",
        code: "ENOENT",
      });
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });

  test("Test 4: captures multiple directory and file enumeration failures in canonical deterministic order", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-multi-failure-"));
    try {
      await mkdir(join(projectPath, "z_failed_dir"));
      await mkdir(join(projectPath, "a_failed_dir"));
      await writeFile(join(projectPath, "m_failed_file.dat"), "x", "utf8");
      await writeFile(join(projectPath, "b_failed_file.dat"), "y", "utf8");
      await writeFile(join(projectPath, "valid.js"), "export const ok = 1;", "utf8");

      const scanner = new FileScanner({
        readdir: (async (path: string, options: any) => {
          if (resolve(path).includes("failed_dir")) {
            const err = new Error("Access denied") as any;
            err.code = "EACCES";
            throw err;
          }
          return readdir(path, options);
        }) as typeof readdir,
        stat: (async (path: string) => {
          if (resolve(path).includes("failed_file")) {
            const err = new Error("I/O error") as any;
            err.code = "EIO";
            throw err;
          }
          return stat(path);
        }) as typeof stat,
      });

      const { files, enumerationFailures } = await scanner.scan(projectPath);

      expect(files.map((f) => f.path)).toEqual(["valid.js"]);
      expect(enumerationFailures).toHaveLength(4);
      // Canonical lexicographic path order: a_failed_dir, b_failed_file.dat, m_failed_file.dat, z_failed_dir
      expect(enumerationFailures.map((f) => f.path)).toEqual([
        "a_failed_dir",
        "b_failed_file.dat",
        "m_failed_file.dat",
        "z_failed_dir",
      ]);
      expect(enumerationFailures.map((f) => f.kind)).toEqual([
        "directory-read",
        "entry-stat",
        "entry-stat",
        "directory-read",
      ]);
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });

  test("Test 5: clean repository produces empty enumerationFailures array and full file inventory", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-clean-"));
    try {
      await writeFile(join(projectPath, "index.ts"), "export const ok = true;", "utf8");
      const { files, enumerationFailures } = await new FileScanner().scan(projectPath);

      expect(files).toHaveLength(1);
      expect(enumerationFailures).toEqual([]);
      expect(files[0]?.path).toBe("index.ts");
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });
});
