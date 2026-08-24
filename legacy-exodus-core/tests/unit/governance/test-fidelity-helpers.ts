import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createLegacyExodusEngine } from "@runtime/composition/services";

/**
 * Ensures that discovery projections exist on disk for the given repository.
 * If `.discovery/files.json` does not exist but the repo does, runs the deterministic engine
 * once to generate all canonical projections before fidelity validation.
 */
export async function ensureDiscoveryProjections(repoPath: string): Promise<void> {
  const absPath = resolve(repoPath);
  const discoveryFile = join(absPath, ".discovery", "files.json");
  const manifestFile = join(absPath, ".discovery", "manifest.json");

  if (existsSync(discoveryFile) && existsSync(manifestFile)) {
    return;
  }

  if (!existsSync(absPath)) {
    throw new Error(
      `Repository directory not found at: ${absPath}. ` +
      `Fidelity tests require target repository to be acquired or present.`,
    );
  }

  const engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });
  await engine.initialize();
  try {
    await engine.execute({
      id: "00000000-0000-4000-8000-000000000099",
      type: "AnalyzeProject",
      createdAt: new Date(),
      payload: {
        projectId: "00000000-0000-4000-8000-000000000098",
        path: absPath,
      },
    });
  } finally {
    await engine.shutdown();
  }
}
