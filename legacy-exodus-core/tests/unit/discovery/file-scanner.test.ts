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
      expect(Object.isFrozen(files)).toBe(true);
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });
});
