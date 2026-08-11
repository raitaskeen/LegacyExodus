import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, test } from "bun:test";

import { DiscoveryEngine } from "@discovery/index";

describe("DiscoveryEngine", () => {
  test("creates an immutable discovery result and corresponding facts", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-discovery-"));
    const projectId = "00000000-0000-4000-8000-000000000020";

    try {
      await mkdir(join(projectPath, "routes"));
      await writeFile(join(projectPath, "routes", "books.js"), "export {};", "utf8");
      await writeFile(
        join(projectPath, "package.json"),
        JSON.stringify({ name: "library-api", dependencies: { express: "4.0.0" } }),
        "utf8",
      );

      const engine = new DiscoveryEngine();
      const discovery = await engine.discover({ projectId, projectPath });
      const events = engine.createEvents(discovery);

      expect(discovery.projectName).toBe("library-api");
      expect(discovery.files).toHaveLength(2);
      expect(discovery.frameworks.map((framework) => framework.name)).toEqual(["express"]);
      expect(events.at(-1)?.type).toBe("DiscoveryCompleted");
      expect(Object.isFrozen(discovery)).toBe(true);
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });
});
