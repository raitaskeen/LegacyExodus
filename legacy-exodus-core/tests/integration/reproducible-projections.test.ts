import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { analyzeProject } from "../../src/cli/commands/analyze";
import { createLegacyExodusEngine } from "@runtime/composition/services";

/**
 * ADR-010 (NA-06): the same source, engine and configuration give byte-identical fact artifacts. Run identity
 * (project id, run id, time) lives in `manifest.json` only, so two CLI runs differ in the manifest and nowhere
 * else. The project id is stable per repository (step 2); run ids stay random.
 */
describe("ADR-010 reproducible projections", () => {
  it("two fresh CLI analyses of the same repository write the same bytes in every fact artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "lx-adr010-"));
    try {
      const projectPath = join(root, "project");
      await mkdir(join(projectPath, "src"), { recursive: true });
      await writeFile(join(projectPath, "package.json"), JSON.stringify({ name: "adr010", version: "1.0.0" }));
      await writeFile(join(projectPath, "src", "app.js"), "function handler(req, res) { res.send(req.body); }\nmodule.exports = { handler };\n");
      const factory = (environment?: Record<string, string | undefined>) => createLegacyExodusEngine({ ...environment, LOG_LEVEL: "silent", LEGACY_EXODUS_HOME: join(root, "home") });

      const manifests: { readonly projectId: string; readonly analysisRunId: string }[] = [];
      const snapshot = async (): Promise<Map<string, string>> => {
        await analyzeProject(projectPath, factory, { refresh: true });
        const directory = join(projectPath, ".discovery");
        manifests.push((JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")) as { analysis: { projectId: string; analysisRunId: string } }).analysis);
        const names = (await readdir(directory)).filter((name) => name.endsWith(".json") && name !== "manifest.json").sort();
        return new Map(await Promise.all(names.map(async (name) => [name, await readFile(join(directory, name), "utf8")] as const)));
      };
      const first = await snapshot();
      const second = await snapshot();

      expect([...first.keys()]).toContain("semantic.json");
      expect([...first.keys()]).toEqual([...second.keys()]);
      for (const [name, bytes] of first) expect({ name, same: second.get(name) === bytes }).toEqual({ name, same: true });
      // Step 2: the repository keeps one project id; each run keeps its own run id.
      expect(manifests[1]!.projectId).toBe(manifests[0]!.projectId);
      expect(manifests[1]!.analysisRunId).not.toBe(manifests[0]!.analysisRunId);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});
