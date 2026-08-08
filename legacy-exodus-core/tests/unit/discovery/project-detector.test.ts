import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, test } from "bun:test";

import type { FileArtifact } from "@contracts/discovery";
import { ProjectDetector } from "@discovery/index";

describe("ProjectDetector", () => {
  test("detects project metadata, dependencies, languages, and frameworks", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-detect-"));
    const files: readonly FileArtifact[] = [
      { id: "package", path: "package.json", language: "unknown", size: 1 },
      { id: "route", path: "routes/books.ts", language: "typescript", size: 1 },
      { id: "component", path: "src/components/Search.tsx", language: "typescript", size: 1 },
    ];

    try {
      await writeFile(
        join(projectPath, "package.json"),
        JSON.stringify({
          name: "library-management-system",
          dependencies: { express: "4.0.0", mongoose: "8.0.0", react: "18.0.0" },
          devDependencies: { typescript: "5.0.0" },
        }),
        "utf8",
      );

      const detection = await new ProjectDetector().detect(projectPath, files);

      expect(detection.projectName).toBe("library-management-system");
      expect(detection.languages).toEqual(["typescript"]);
      expect(detection.frameworks.map((framework) => framework.name)).toEqual([
        "express",
        "mongodb",
        "react",
      ]);
      expect(detection.dependencies).toHaveLength(4);
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });
});
