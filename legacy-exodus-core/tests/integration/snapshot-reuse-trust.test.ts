import { describe, expect, it } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { analyzeProject } from "../../src/cli/commands/analyze";
import { createLegacyExodusEngine } from "@runtime/composition/services";

// F-001: snapshot reuse must be bound to the analyzer that produced it, to the
// canonical project location, and to a local secret the analyzed repository
// cannot know. Reuse must also be visible to the caller.

const SNAPSHOT_KEY_FILE = "snapshot-hmac.key";
const handlerSource = "function handler(req, res) { const value = req.body; res.send(value); }\nmodule.exports = handler;\n";

type Environment = Record<string, string | undefined>;
type FingerprintOption = { readonly analyzerFingerprint?: () => Promise<string | undefined> };
type EngineFactory = (environment: Environment, options?: FingerprintOption) => ReturnType<typeof createLegacyExodusEngine>;
// The composition options are part of the F-001 contract; the cast keeps this file
// executable against builds that predate them so the baseline failure is behavioral.
const createEngine = createLegacyExodusEngine as unknown as EngineFactory;

async function createProject(root: string, name: string): Promise<string> {
  const projectPath = join(root, name);
  await mkdir(projectPath, { recursive: true });
  await writeFile(join(projectPath, "package.json"), JSON.stringify({ name: "f001-trust", version: "1.0.0" }));
  await writeFile(join(projectPath, "handler.js"), handlerSource);
  return projectPath;
}

function environmentFor(home: string): Environment {
  return { LOG_LEVEL: "silent", NODE_ENV: "test", LEGACY_EXODUS_HOME: home };
}

async function analyze(projectPath: string, environment: Environment, options?: FingerprintOption) {
  const engine = createEngine(environment, options);
  await engine.initialize();
  try {
    const result = await engine.execute({
      id: randomUUID(),
      type: "AnalyzeProject",
      createdAt: new Date(),
      payload: { projectId: randomUUID(), path: projectPath },
    });
    if (result.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject");
    return result;
  } finally {
    await engine.shutdown();
  }
}

async function readManifest(projectPath: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(join(projectPath, ".discovery", "manifest.json"), "utf8"));
}

async function writeManifest(projectPath: string, manifest: unknown): Promise<void> {
  await writeFile(join(projectPath, ".discovery", "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function taintFlowCount(projectPath: string): Promise<number> {
  const dataFlow = JSON.parse(await readFile(join(projectPath, ".discovery", "data-flow.json"), "utf8"));
  return dataFlow.graphs.flatMap((graph: { taintFlows: unknown[] }) => graph.taintFlows).length;
}

async function withScratch(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "lx-f001-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("F-001 snapshot reuse trust boundary", () => {
  it("control: reuses an untouched snapshot produced by the same analyzer and local key", async () => {
    await withScratch(async (root) => {
      const projectPath = await createProject(root, "project");
      const environment = environmentFor(join(root, "home"));
      expect((await analyze(projectPath, environment)).isReused).toBeUndefined();
      expect((await analyze(projectPath, environment)).isReused).toBe(true);
    });
  });

  it("rejects an artifact that was edited and re-hashed after projection", async () => {
    await withScratch(async (root) => {
      const projectPath = await createProject(root, "project");
      const environment = environmentFor(join(root, "home"));
      await analyze(projectPath, environment);
      expect(await taintFlowCount(projectPath)).toBe(1);

      const dataFlowPath = join(projectPath, ".discovery", "data-flow.json");
      const dataFlow = JSON.parse(await readFile(dataFlowPath, "utf8"));
      for (const graph of dataFlow.graphs) graph.taintFlows = [];
      const forged = `${JSON.stringify(dataFlow, null, 2)}\n`;
      await writeFile(dataFlowPath, forged);
      const manifest = await readManifest(projectPath);
      manifest.artifacts["data-flow.json"] = {
        sha256: createHash("sha256").update(forged).digest("hex"),
        bytes: Buffer.byteLength(forged),
      };
      await writeManifest(projectPath, manifest);

      const second = await analyze(projectPath, environment);
      expect(second.isReused).toBeUndefined();
      expect(await taintFlowCount(projectPath)).toBe(1);
    });
  });

  it("rejects a manifest whose recorded engine identity was rewritten", async () => {
    await withScratch(async (root) => {
      const projectPath = await createProject(root, "project");
      const environment = environmentFor(join(root, "home"));
      await analyze(projectPath, environment);

      const manifest = await readManifest(projectPath);
      manifest.engine = { packageVersion: "0.0.0-forged", commitSha: "0".repeat(40), bunVersion: "bun-0.0.0" };
      await writeManifest(projectPath, manifest);

      expect((await analyze(projectPath, environment)).isReused).toBeUndefined();
    });
  });

  it("rejects a snapshot authenticated by a different local key (foreign .discovery)", async () => {
    await withScratch(async (root) => {
      const projectPath = await createProject(root, "project");
      await analyze(projectPath, environmentFor(join(root, "author-home")));

      const second = await analyze(projectPath, environmentFor(join(root, "victim-home")));
      expect(second.isReused).toBeUndefined();
    });
  });

  it("rejects a snapshot produced by a different analyzer build and reuses one from the same build", async () => {
    await withScratch(async (root) => {
      const projectPath = await createProject(root, "project");
      const environment = environmentFor(join(root, "home"));
      const buildA = { analyzerFingerprint: async () => `lx-analyzer-v1:${"a".repeat(64)}` };
      const buildB = { analyzerFingerprint: async () => `lx-analyzer-v1:${"b".repeat(64)}` };

      await analyze(projectPath, environment, buildA);
      expect((await analyze(projectPath, environment, buildB)).isReused).toBeUndefined();
      // The fresh run above re-projected the snapshot under build B.
      expect((await analyze(projectPath, environment, buildB)).isReused).toBe(true);
    });
  });

  it("binds the snapshot to its canonical location so a cwd-relative path cannot select it elsewhere", async () => {
    await withScratch(async (root) => {
      const originalProject = await createProject(join(root, "a"), "proj");
      const copiedProject = await createProject(join(root, "b"), "proj");
      const environment = environmentFor(join(root, "home"));
      const originalCwd = process.cwd();
      try {
        process.chdir(join(root, "a"));
        await analyze("proj", environment);
        await cp(join(originalProject, ".discovery"), join(copiedProject, ".discovery"), { recursive: true });

        process.chdir(join(root, "b"));
        expect((await analyze("proj", environment)).isReused).toBeUndefined();
      } finally {
        process.chdir(originalCwd);
      }
      expect((await readManifest(originalProject)).repository.path).not.toBe("proj");
    });
  });

  it("reports snapshot reuse and its source run in the CLI analyze report", async () => {
    await withScratch(async (root) => {
      const projectPath = await createProject(root, "project");
      const home = join(root, "home");
      const factory = (environment?: Environment) => createLegacyExodusEngine({ ...environment, LOG_LEVEL: "silent", LEGACY_EXODUS_HOME: home });

      const first = await analyzeProject(projectPath, factory) as unknown as Record<string, unknown>;
      expect(first.reused).toBe(false);
      expect(first.snapshotAnalysisRunId).toBeUndefined();

      const second = await analyzeProject(projectPath, factory) as unknown as Record<string, unknown>;
      expect(second.reused).toBe(true);
      expect(second.snapshotAnalysisRunId).toBe((await readManifest(projectPath)).analysis.analysisRunId);
    });
  });

  it("still publishes analysis when repository metadata cannot be authenticated, and never reuses it", async () => {
    await withScratch(async (root) => {
      const projectPath = await createProject(root, "project");
      // A non-string version is outside the manifest contract; it must not fail the committed analysis.
      await writeFile(join(projectPath, "package.json"), JSON.stringify({ name: "f001-trust", version: 1 }));
      const environment = environmentFor(join(root, "home"));

      expect((await analyze(projectPath, environment)).isReused).toBeUndefined();
      expect(await taintFlowCount(projectPath)).toBe(1);
      expect((await readManifest(projectPath)).integrity).toBeUndefined();
      expect((await analyze(projectPath, environment)).isReused).toBeUndefined();
    });
  });

  it("stores the snapshot key under the configured home, never inside the analyzed project", async () => {
    await withScratch(async (root) => {
      const projectPath = await createProject(root, "project");
      const home = join(root, "home");
      await analyze(projectPath, environmentFor(home));

      expect((await stat(join(home, SNAPSHOT_KEY_FILE))).size).toBe(32);
      const projectEntries = await readdir(projectPath, { recursive: true });
      expect(projectEntries.some((entry) => String(entry).endsWith(SNAPSHOT_KEY_FILE))).toBe(false);
    });
  });
});
