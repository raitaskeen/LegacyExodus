import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, test } from "bun:test";

import { createLegacyExodusEngine } from "@core/engine";

describe("analyze project integration", () => {
  test("runs deterministic discovery through the engine facade", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-analyze-"));

    try {
      await mkdir(join(projectPath, "src", "components"), { recursive: true });
      await writeFile(join(projectPath, "src", "components", "Books.jsx"), "export {};", "utf8");
      await writeFile(
        join(projectPath, "package.json"),
        JSON.stringify({
          name: "library-management-system",
          dependencies: { express: "4.0.0", mongodb: "6.0.0", react: "18.0.0" },
        }),
        "utf8",
      );
      const engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });

      await engine.initialize();
      const result = await engine.execute({
        id: "00000000-0000-4000-8000-000000000030",
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: {
          projectId: "00000000-0000-4000-8000-000000000031",
          path: projectPath,
        },
      });

      expect(result.type).toBe("AnalyzeProject");

      if (result.type === "AnalyzeProject") {
        expect(result.discovery.projectName).toBe("library-management-system");
        expect(result.discovery.frameworks.map((framework) => framework.name)).toEqual([
          "express",
          "mongodb",
          "react",
        ]);
      }

      expect(JSON.parse(await readFile(join(projectPath, ".discovery", "summary.json"), "utf8"))).toEqual({
        projectName: "library-management-system",
        fileCount: 2,
        dependencyCount: 3,
        frameworkCount: 3,
        languages: ["javascript"],
      });

      await engine.shutdown();
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });
});
