import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, test } from "bun:test";

import { DiscoveryEngine, FileScanner } from "@discovery/index";

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
      expect(discovery.enumerationFailures).toEqual([]);
      expect(events.at(-1)?.type).toBe("DiscoveryCompleted");
      expect(Object.isFrozen(discovery)).toBe(true);
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });

  test("generates DiscoveryEnumerationFailure domain events when enumeration failures are recorded", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-discovery-fail-"));
    const projectId = "00000000-0000-4000-8000-000000000021";

    try {
      await writeFile(join(projectPath, "app.js"), "export const ok = true;", "utf8");
      await mkdir(join(projectPath, "secret"));

      const scanner = new FileScanner({
        readdir: (async (path: string, options: any) => {
          if (path.includes("secret")) {
            const err = new Error("EACCES") as any;
            err.code = "EACCES";
            throw err;
          }
          return readdir(path, options);
        }) as typeof readdir,
      });

      const engine = new DiscoveryEngine(scanner);
      const discovery = await engine.discover({ projectId, projectPath });
      const events = engine.createEvents(discovery);

      expect(discovery.files).toHaveLength(1);
      expect(discovery.enumerationFailures).toHaveLength(1);
      expect(discovery.enumerationFailures[0]?.path).toBe("secret");
      expect(discovery.enumerationFailures[0]?.kind).toBe("directory-read");
      expect(discovery.enumerationFailures[0]?.code).toBe("EACCES");

      const failureEvents = events.filter((e) => e.type === "DiscoveryEnumerationFailure");
      expect(failureEvents).toHaveLength(1);
      expect((failureEvents[0]?.payload as any).path).toBe("secret");
      expect((failureEvents[0]?.payload as any).kind).toBe("directory-read");

      const completionEvent = events.find((e) => e.type === "DiscoveryCompleted");
      expect(completionEvent).toBeDefined();
      expect((completionEvent?.payload as any).enumerationFailureCount).toBe(1);
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });
});
