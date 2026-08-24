import { existsSync } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createLegacyExodusEngine } from "@runtime/composition/services";
import { CORPUS_DIR } from "../../../benchmarks/paths";
import type { BenchmarkManifest } from "../../../benchmarks/types";

async function findCorpusManifest(repoName: string): Promise<BenchmarkManifest | null> {
  const tiers = ["tier-1", "tier-2", "tier-3"];
  for (const tier of tiers) {
    const manifestPath = join(CORPUS_DIR, tier, `${repoName}.json`);
    if (existsSync(manifestPath)) {
      try {
        const raw = await readFile(manifestPath, "utf8");
        return JSON.parse(raw) as BenchmarkManifest;
      } catch {}
    }
  }

  try {
    const entries = await readdir(CORPUS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const candidate = join(CORPUS_DIR, entry.name, `${repoName}.json`);
        if (existsSync(candidate)) {
          const raw = await readFile(candidate, "utf8");
          return JSON.parse(raw) as BenchmarkManifest;
        }
      }
    }
  } catch {}

  return null;
}

async function acquireRepository(manifest: BenchmarkManifest, targetDir: string): Promise<void> {
  if (!manifest.repository) {
    throw new Error(`Cannot acquire repository '${manifest.name}': manifest has no repository URL.`);
  }

  await mkdir(dirname(targetDir), { recursive: true });

  const cloneArgs = ["clone", "--depth", "1"];
  if (manifest.revision) {
    cloneArgs.push("--branch", manifest.revision);
  }
  cloneArgs.push(manifest.repository, targetDir);

  const proc = Bun.spawn(["git", ...cloneArgs], {
    stdout: "ignore",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();

    if (manifest.revision && stderr.includes("Could not find remote branch")) {
      const fullClone = Bun.spawn(["git", "clone", manifest.repository, targetDir], {
        stdout: "ignore",
        stderr: "pipe",
      });
      const fullExitCode = await fullClone.exited;
      if (fullExitCode === 0) {
        const checkout = Bun.spawn(["git", "checkout", manifest.revision], {
          cwd: targetDir,
          stdout: "ignore",
          stderr: "ignore",
        });
        await checkout.exited;
        return;
      }
    }

    throw new Error(`Failed to clone repository '${manifest.name}' from ${manifest.repository}: ${stderr.trim()}`);
  }
}

/**
 * Ensures that discovery projections exist on disk for the given repository.
 * If the target repository is not present in .cache, acquires it on-demand from its corpus manifest.
 * If `.discovery/files.json` does not exist, runs the deterministic engine once to generate all
 * canonical projections before fidelity validation.
 */
export async function ensureDiscoveryProjections(repoPath: string): Promise<void> {
  const absPath = resolve(repoPath);
  const discoveryFile = join(absPath, ".discovery", "files.json");
  const manifestFile = join(absPath, ".discovery", "manifest.json");

  if (existsSync(discoveryFile) && existsSync(manifestFile)) {
    return;
  }

  if (!existsSync(absPath)) {
    const repoName = basename(absPath);
    const manifest = await findCorpusManifest(repoName);
    if (manifest) {
      await acquireRepository(manifest, absPath);
    }
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
