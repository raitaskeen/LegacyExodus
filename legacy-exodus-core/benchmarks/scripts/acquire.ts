/**
 * Phase 3A — Repository Acquisition Script
 *
 * Reads benchmark manifests from corpus/ directories and clones repositories
 * to the local .cache/ directory at their pinned revisions.
 *
 * Usage:
 *   bun run benchmarks/scripts/acquire.ts [--tier tier-1|tier-2|tier-3] [--name repo-name]
 */

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { BenchmarkManifest } from "../types";

const CACHE_DIR = resolve(import.meta.dir, "..", ".cache");
const CORPUS_DIR = resolve(import.meta.dir, "..", "corpus");

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const tierFilter = getArgValue(args, "--tier");
  const nameFilter = getArgValue(args, "--name");

  console.log("LegacyExodus — Repository Acquisition\n");

  const tiers = tierFilter
    ? [tierFilter]
    : await readdir(CORPUS_DIR).catch(() => [] as string[]);

  await mkdir(CACHE_DIR, { recursive: true });

  let acquired = 0;
  let skipped = 0;

  for (const tier of tiers) {
    const tierDir = join(CORPUS_DIR, tier);
    let manifests: string[];
    try {
      manifests = (await readdir(tierDir)).filter((f) => f.endsWith(".json"));
    } catch {
      continue;
    }

    for (const manifestFile of manifests) {
      const manifest = JSON.parse(
        await readFile(join(tierDir, manifestFile), "utf8"),
      ) as BenchmarkManifest;

      if (nameFilter && manifest.name !== nameFilter) continue;

      if (manifest.localPath) {
        console.log(`  [skip] ${manifest.name} — local path: ${manifest.localPath}`);
        skipped++;
        continue;
      }

      if (!manifest.repository) {
        console.log(`  [skip] ${manifest.name} — no repository URL`);
        skipped++;
        continue;
      }

      const targetDir = join(CACHE_DIR, manifest.name);

      if (existsSync(targetDir)) {
        console.log(`  [exists] ${manifest.name} → ${targetDir}`);
        skipped++;
        continue;
      }

      console.log(`  [clone] ${manifest.name} @ ${manifest.revision ?? "HEAD"}`);

      const cloneArgs = ["clone", "--depth", "1"];
      if (manifest.revision) {
        cloneArgs.push("--branch", manifest.revision);
      }
      cloneArgs.push(manifest.repository, targetDir);

      const proc = Bun.spawn(["git", ...cloneArgs], {
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text();
        console.error(`    ✗ Clone failed (exit ${exitCode}): ${stderr.trim()}`);

        // Retry without --branch for commit SHAs
        if (manifest.revision && stderr.includes("Could not find remote branch")) {
          console.log(`    Retrying full clone + checkout for commit SHA...`);
          const fullClone = Bun.spawn(["git", "clone", manifest.repository, targetDir], {
            stdout: "pipe",
            stderr: "pipe",
          });
          const fullExitCode = await fullClone.exited;
          if (fullExitCode === 0) {
            const checkout = Bun.spawn(["git", "checkout", manifest.revision], {
              cwd: targetDir,
              stdout: "pipe",
              stderr: "pipe",
            });
            await checkout.exited;
            console.log(`    ✓ Acquired at ${manifest.revision}`);
            acquired++;
            continue;
          }
        }
        continue;
      }

      console.log(`    ✓ Acquired`);
      acquired++;
    }
  }

  console.log(`\nDone: ${acquired} acquired, ${skipped} skipped.`);
}

function getArgValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

main().catch((error: unknown) => {
  console.error("Acquisition failed:", error);
  process.exit(1);
});
