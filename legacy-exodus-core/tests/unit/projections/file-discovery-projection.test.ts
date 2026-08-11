import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, test } from "bun:test";

import { createDiscoveryProjection } from "@contracts/discovery-projection";
import { FileDiscoveryProjectionAdapter } from "@storage/index";

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
});
