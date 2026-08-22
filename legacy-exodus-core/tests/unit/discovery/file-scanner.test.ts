import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
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

      const files = await new FileScanner().scan(projectPath);

      expect(files.map((file) => file.path)).toEqual(["controllers/books.js", "package.json"]);
      expect(files[0]?.language).toBe("javascript");
      expect(files[0]?.fileKind).toBe("source");
      expect(files[1]?.language).toBe("json");
      expect(files[1]?.fileKind).toBe("manifest");
      expect(Object.isFrozen(files)).toBe(true);
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
      const byPath = new Map((await new FileScanner().scan(projectPath)).map((file) => [file.path, file]));
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
      const byPath = new Map((await new FileScanner().scan(projectPath)).map((file) => [file.path, file]));

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
        // Fallback for non-Windows platforms
        try {
          await symlink(join(projectPath, "src"), join(projectPath, "linked_src"), "dir");
        } catch {
          // If OS forbids symlink creation in unprivileged environment, test passes trivially
        }
      }

      const files = await new FileScanner().scan(projectPath);
      const paths = files.map((file) => file.path);

      // Only the real file is discovered; the symlink/junction is excluded
      expect(paths).toEqual(["src/index.js"]);
      expect(files[0]?.fileKind).toBe("source");
      expect(files[0]?.language).toBe("javascript");
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });
});
