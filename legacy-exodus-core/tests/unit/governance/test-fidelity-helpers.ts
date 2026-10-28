import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createLegacyExodusEngine } from "@runtime/composition/services";
import { fingerprintAnalyzerSource, loadedAnalyzerFingerprint } from "../../support/analyzer-identity";
import { CORPUS_DIR } from "../../../benchmarks/paths";
import { ensurePinnedRepository } from "../../../benchmarks/scripts/acquire";
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

/**
 * A directory named after a corpus manifest is that corpus. A missing one is fetched at the
 * manifest's pinned commit; an existing one is reused only after its HEAD tree equals the
 * manifest's `tree`. A mismatch, or a directory without its own `.git`, throws (BA-20 / A6).
 * Directories that name no manifest are not corpora and are left alone.
 */
async function ensureCorpusCheckout(absPath: string): Promise<void> {
  const manifest = await findCorpusManifest(basename(absPath));
  if (manifest === null) return;
  if (manifest.repository === undefined) {
    if (!existsSync(absPath)) {
      throw new Error(`Cannot acquire repository '${manifest.name}': manifest has no repository URL.`);
    }
    return;
  }
  await ensurePinnedRepository(manifest, absPath);
}

const ANALYZER_ROOT = resolve(import.meta.dir, "../../..");

// Written next to the projection; deliberately not `*.json`, so tools that enumerate
// `.discovery/*.json` as analysis artifacts never see it.
const IDENTITY_RECORD_FILE = "fidelity-helper.identity";

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

async function isRecordedProjectionCurrent(discoveryDir: string, analyzerFingerprint: string): Promise<boolean> {
  try {
    const record = JSON.parse(await readFile(join(discoveryDir, IDENTITY_RECORD_FILE), "utf8"));
    const manifest = await readFile(join(discoveryDir, "manifest.json"));
    return record?.analyzerFingerprint === analyzerFingerprint && record?.manifestSha256 === sha256(manifest);
  } catch {
    return false;
  }
}

/**
 * Ensures that discovery projections produced by the current analyzer exist on disk for the given repository.
 * If the target repository is not present in .cache, acquires it on-demand from its corpus manifest, at the
 * commit the manifest pins. Whenever the target is a corpus repository, existing or new, its HEAD tree is
 * verified against the manifest's `tree` first, so neither a cached checkout nor a projection derived from
 * it is reused after the corpus content changed.
 *
 * An existing projection is reused only when the helper itself generated it and recorded, next to it,
 * the analyzer source fingerprint and the digest of the manifest it produced. Git HEAD and the manifest's
 * engine SHA are not analyzer identity: neither changes while engine edits are uncommitted. Otherwise the
 * engine regenerates the projection with `refresh`, bypassing the engine's own snapshot reuse.
 *
 * `analyzerRoot` (default: this package) names the analyzer source tree to fingerprint. For the default
 * root the identity is the one the test preload captured before any test file loaded the engine; an
 * explicit root is fingerprinted at the start of each call so tests can model analyzer source changes.
 * Before recording, the source is fingerprinted again: if it changed during the run, the code that
 * produced the projection can no longer be identified, so no record is written. `afterAnalysis` runs
 * between the engine run and that check.
 */
export async function ensureDiscoveryProjections(
  repoPath: string,
  options?: { readonly force?: boolean; readonly analyzerRoot?: string; readonly afterAnalysis?: () => Promise<void> },
): Promise<void> {
  const absPath = resolve(repoPath);
  const discoveryDir = join(absPath, ".discovery");
  const analyzerRoot = options?.analyzerRoot === undefined ? ANALYZER_ROOT : resolve(options.analyzerRoot);
  const analyzerFingerprint = options?.analyzerRoot === undefined
    ? loadedAnalyzerFingerprint
    : fingerprintAnalyzerSource(analyzerRoot);

  // Before any reuse: a projection of content that is no longer the pinned content is not evidence.
  await ensureCorpusCheckout(absPath);

  if (
    !options?.force &&
    analyzerFingerprint !== undefined &&
    existsSync(join(discoveryDir, "files.json")) &&
    await isRecordedProjectionCurrent(discoveryDir, analyzerFingerprint)
  ) {
    return;
  }

  await rm(join(discoveryDir, IDENTITY_RECORD_FILE), { force: true });

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
        refresh: true,
      },
    });
  } finally {
    await engine.shutdown();
  }

  await options?.afterAnalysis?.();
  if (analyzerFingerprint !== undefined && fingerprintAnalyzerSource(analyzerRoot) === analyzerFingerprint) {
    const manifest = await readFile(join(discoveryDir, "manifest.json"));
    await writeFile(
      join(discoveryDir, IDENTITY_RECORD_FILE),
      JSON.stringify({ schemaVersion: 1, analyzerFingerprint, manifestSha256: sha256(manifest) }),
      "utf8",
    );
  }
}
