import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { createLegacyExodusEngine } from "@runtime/composition/services";
import { DiscoveryValidator } from "@discovery/discovery-validator";

describe("Phase 3A P0.4 — Discovery Snapshot Reuse & Invalidation", () => {
  let testRepoDir: string;

  beforeEach(async () => {
    testRepoDir = join(tmpdir(), `legacy-exodus-reuse-test-${randomUUID()}`);
    await mkdir(join(testRepoDir, "src"), { recursive: true });

    // Create a minimal package.json
    await writeFile(
      join(testRepoDir, "package.json"),
      JSON.stringify(
        {
          name: "test-reuse-project",
          version: "1.0.0",
          dependencies: {
            express: "^4.18.2",
          },
          devDependencies: {
            typescript: "^5.0.0",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    // Create a couple of JS/TS source files
    await writeFile(
      join(testRepoDir, "src", "index.ts"),
      `
      import express from "express";
      export const app = express();
      export function start(port: number) {
        app.listen(port);
      }
      `,
      "utf8",
    );

    await writeFile(
      join(testRepoDir, "src", "helper.js"),
      `
      function add(a, b) {
        return a + b;
      }
      module.exports = { add };
      `,
      "utf8",
    );
  });

  afterEach(async () => {
    try {
      await rm(testRepoDir, { recursive: true, force: true });
    } catch {}
  });

  it("Scenario 1: Fresh run discovers project, persists valid snapshot with SHA-256", async () => {
    const engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    await engine.initialize();

    try {
      const result = await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: testRepoDir },
      });

      expect(result.type).toBe("AnalyzeProject");
      if (result.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject result");
      expect(result.discovery.projectName).toBe("test-reuse-project");
      expect(result.discovery.files.length).toBeGreaterThanOrEqual(3);
      expect(result.discovery.dependencies.length).toBe(2);
      expect(result.analysis.filesAnalyzed).toBe(2); // index.ts and helper.js

      // Verify .discovery/manifest.json is valid
      const validator = new DiscoveryValidator();
      const validation = await validator.validate({ projectPath: testRepoDir });
      expect(validation.valid).toBe(true);
      expect(validation.status).toBe("VALID");
      expect(validation.manifest).toBeDefined();
    } finally {
      await engine.shutdown();
    }
  });

  it("Scenario 2: Second run on valid snapshot reuses discovery without full re-parsing", async () => {
    const engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    await engine.initialize();

    try {
      // 1. First run creates the valid snapshot
      const firstRun = await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: testRepoDir },
      });
      expect(firstRun.type).toBe("AnalyzeProject");
      if (firstRun.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject");
      expect(firstRun.discovery.files.length).toBeGreaterThanOrEqual(3);

      // 2. Second run on same repo
      const secondRun = await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: testRepoDir },
      });

      expect(secondRun.type).toBe("AnalyzeProject");
      if (secondRun.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject");
      expect(secondRun.discovery.projectName).toBe("test-reuse-project");
      expect(secondRun.discovery.files.length).toBe(firstRun.discovery.files.length);
      expect(secondRun.discovery.dependencies.length).toBe(firstRun.discovery.dependencies.length);
      expect(secondRun.analysis.filesAnalyzed).toBe(firstRun.analysis.filesAnalyzed);
      expect(secondRun.analysis.filesDiscovered).toBe(firstRun.analysis.filesDiscovered);
      expect(secondRun.analysis.durationMs).toBeLessThanOrEqual(firstRun.analysis.durationMs + 50);

      // Snapshot remains valid
      const validator = new DiscoveryValidator();
      const validation = await validator.validate({ projectPath: testRepoDir });
      expect(validation.valid).toBe(true);
    } finally {
      await engine.shutdown();
    }
  });

  it("Scenario 3: Corrupted projection artifact triggers invalidation and safe fresh fallback", async () => {
    const engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    await engine.initialize();

    try {
      // 1. First run generates valid snapshot
      await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: testRepoDir },
      });

      // 2. Corrupt one artifact by appending invalid data
      const filesJsonPath = join(testRepoDir, ".discovery", "files.json");
      await writeFile(filesJsonPath, "[] /* corrupted */", "utf8");

      // Verify validator detects the checksum mismatch
      const validator = new DiscoveryValidator();
      const preValidation = await validator.validate({ projectPath: testRepoDir });
      expect(preValidation.valid).toBe(false);
      expect(preValidation.status).toBe("CHECKSUM_MISMATCH");

      // 3. Re-running analyze should detect the invalidation and safely re-run fresh discovery
      const recoveryRun = await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: testRepoDir },
      });

      expect(recoveryRun.type).toBe("AnalyzeProject");
      if (recoveryRun.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject");
      expect(recoveryRun.discovery.files.length).toBeGreaterThanOrEqual(3);

      // Snapshot is restored to valid state
      const postValidation = await validator.validate({ projectPath: testRepoDir });
      expect(postValidation.valid).toBe(true);
      expect(postValidation.status).toBe("VALID");
    } finally {
      await engine.shutdown();
    }
  });

  it("Scenario 4: Explicit refresh forces fresh discovery even if snapshot is valid", async () => {
    const engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    await engine.initialize();

    try {
      // 1. Initial run
      await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: testRepoDir },
      });

      // Add a new file to the repo
      await writeFile(join(testRepoDir, "src", "new-module.ts"), "export const x = 42;", "utf8");

      // 2. Run with refresh: true
      const refreshedRun = await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: testRepoDir, refresh: true },
      });

      // Refreshed run sees the new file
      expect(refreshedRun.type).toBe("AnalyzeProject");
      if (refreshedRun.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject");
      const foundNewFile = refreshedRun.discovery.files.some((f: { path: string }) => f.path.includes("new-module.ts"));
      expect(foundNewFile).toBe(true);
    } finally {
      await engine.shutdown();
    }
  });

  it("Scenario 5: Project isolation prevents cross-project cache contamination", async () => {
    const projectBDir = join(tmpdir(), `legacy-exodus-reuse-projB-${randomUUID()}`);
    await mkdir(join(projectBDir, "src"), { recursive: true });
    await writeFile(
      join(projectBDir, "package.json"),
      JSON.stringify({ name: "project-b", version: "2.0.0" }, null, 2),
      "utf8",
    );
    await writeFile(join(projectBDir, "src", "b.js"), "module.exports = 'B';", "utf8");

    const engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });
    await engine.initialize();

    try {
      // Analyze Project A
      const resA = await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: testRepoDir },
      });

      // Analyze Project B
      const resB = await engine.execute({
        id: randomUUID(),
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: { projectId: randomUUID(), path: projectBDir },
      });

      expect(resA.type).toBe("AnalyzeProject");
      expect(resB.type).toBe("AnalyzeProject");
      if (resA.type !== "AnalyzeProject" || resB.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject");
      expect(resA.discovery.projectName).toBe("test-reuse-project");
      expect(resB.discovery.projectName).toBe("project-b");
      expect(resA.discovery.projectPath).not.toBe(resB.discovery.projectPath);

      // Verify separate .discovery manifests
      const validator = new DiscoveryValidator();
      const valA = await validator.validate({ projectPath: testRepoDir });
      const valB = await validator.validate({ projectPath: projectBDir });

      expect(valA.valid).toBe(true);
      expect(valB.valid).toBe(true);
      expect(valA.manifest?.repository.name).toBe("test-reuse-project");
      expect(valB.manifest?.repository.name).toBe("project-b");
    } finally {
      await engine.shutdown();
      try {
        await rm(projectBDir, { recursive: true, force: true });
      } catch {}
    }
  });
});
