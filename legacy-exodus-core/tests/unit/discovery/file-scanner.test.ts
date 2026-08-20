import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
});
