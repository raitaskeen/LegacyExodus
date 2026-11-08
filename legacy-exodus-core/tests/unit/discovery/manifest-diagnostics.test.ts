import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import type { FileArtifact } from "@contracts/discovery";
import { ProjectDetector } from "@discovery/index";

const packageArtifact: FileArtifact = Object.freeze({
  id: "package-json",
  path: "package.json",
  language: "json",
  fileKind: "manifest",
  size: 1,
});

describe("ProjectDetector manifest diagnostics", () => {
  test("distinguishes valid and absent manifests without false failures", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-manifest-valid-"));

    try {
      await writeFile(
        join(projectPath, "package.json"),
        JSON.stringify({ name: "valid-app", dependencies: { express: "4.0.0" } }),
        "utf8",
      );

      const valid = await new ProjectDetector().detect(projectPath, [packageArtifact]);
      const absent = await new ProjectDetector().detect(projectPath, []);

      expect(valid.projectName).toBe("valid-app");
      expect(valid.dependencies).toEqual([
        { name: "express", version: "4.0.0", kind: "production" },
      ]);
      expect(valid.manifestFailures).toEqual([]);
      expect(absent.manifestFailures).toEqual([]);
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });

  test("reports zero-byte and malformed manifests as deterministic parse failures", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy exodus 清单 "));

    try {
      const detector = new ProjectDetector();

      await writeFile(join(projectPath, "package.json"), "", "utf8");
      const emptyFirst = await detector.detect(projectPath, [packageArtifact]);
      const emptySecond = await detector.detect(projectPath, [packageArtifact]);

      expect(emptyFirst.manifestFailures).toEqual([
        { path: "package.json", kind: "manifest-parse", code: "INVALID_JSON" },
      ]);
      expect(emptySecond.manifestFailures).toEqual(emptyFirst.manifestFailures);
      expect(Object.isFrozen(emptyFirst.manifestFailures)).toBe(true);
      expect(Object.isFrozen(emptyFirst.manifestFailures[0])).toBe(true);

      await writeFile(join(projectPath, "package.json"), '{ "name":', "utf8");
      const malformed = await detector.detect(projectPath, [packageArtifact]);

      expect(malformed.manifestFailures).toEqual([
        { path: "package.json", kind: "manifest-parse", code: "INVALID_JSON" },
      ]);
      expect(malformed.dependencies).toEqual([]);
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });

  test("reports valid JSON with an invalid package schema without weakening validation", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-manifest-schema-"));

    try {
      await writeFile(
        join(projectPath, "package.json"),
        JSON.stringify({ dependencies: { express: 123 } }),
        "utf8",
      );

      const detection = await new ProjectDetector().detect(projectPath, [packageArtifact]);

      expect(detection.manifestFailures).toEqual([
        { path: "package.json", kind: "manifest-validation", code: "SCHEMA_INVALID" },
      ]);
      expect(detection.dependencies).toEqual([]);
      expect(detection.frameworks).toEqual([]);
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });

  test("distinguishes structured read failures from manifest absence", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-manifest-read-"));

    try {
      const readFailure = new ProjectDetector({
        readFile: async (): Promise<string> => {
          const error = new Error("permission denied") as Error & { code: string };
          error.code = "EACCES";
          throw error;
        },
      });
      const missing = new ProjectDetector({
        readFile: async (): Promise<string> => {
          const error = new Error("missing") as Error & { code: string };
          error.code = "ENOENT";
          throw error;
        },
      });

      const unreadable = await readFailure.detect(projectPath, [packageArtifact]);
      const absent = await missing.detect(projectPath, [packageArtifact]);

      expect(unreadable.manifestFailures).toEqual([
        { path: "package.json", kind: "manifest-read", code: "EACCES" },
      ]);
      expect(absent.manifestFailures).toEqual([]);
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });
});
