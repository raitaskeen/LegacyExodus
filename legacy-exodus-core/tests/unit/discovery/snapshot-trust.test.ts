import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { computeManifestMac, manifestKeyId, MANIFEST_MAC_ALGORITHM, verifyManifestMac, type DiscoveryManifest } from "@discovery/discovery-manifest";
import { DiscoveryValidator } from "@discovery/discovery-validator";
import { createSnapshotTrust, SNAPSHOT_KEY_FILE_NAME, SnapshotKeyStore } from "@discovery/snapshot-trust";
import { computeAnalyzerFingerprint } from "@runtime/analyzer-fingerprint";

const FINGERPRINT = `lx-analyzer-v1:${"c".repeat(64)}`;

async function withScratch(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "lx-f001-unit-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Builds a minimal integrity-valid snapshot and returns its unsigned manifest. */
async function createSnapshot(projectPath: string, repositoryPath: string): Promise<DiscoveryManifest> {
  await mkdir(join(projectPath, ".discovery"), { recursive: true });
  await writeFile(join(projectPath, "index.js"), "module.exports = 1;\n");
  const files = JSON.stringify([{ path: "index.js", size: 20 }]);
  await writeFile(join(projectPath, ".discovery", "files.json"), files);
  return {
    schemaVersion: 1,
    repository: { name: "fixture", path: repositoryPath },
    engine: { packageVersion: "0.1.0", commitSha: "local", bunVersion: "bun-test" },
    analysis: { projectId: "00000000-0000-4000-8000-000000000000", generatedAt: new Date(0).toISOString() },
    requiredArtifacts: ["files.json"],
    artifacts: { "files.json": { sha256: createHash("sha256").update(files).digest("hex"), bytes: Buffer.byteLength(files) } },
  };
}

function sign(manifest: DiscoveryManifest, key: Buffer, fingerprint = FINGERPRINT): DiscoveryManifest {
  const unsigned = { ...manifest, analyzer: { fingerprint } };
  return { ...unsigned, integrity: { algorithm: MANIFEST_MAC_ALGORITHM, keyId: manifestKeyId(key), mac: computeManifestMac(unsigned, key) } };
}

async function writeManifest(projectPath: string, manifest: unknown): Promise<void> {
  await writeFile(join(projectPath, ".discovery", "manifest.json"), JSON.stringify(manifest));
}

describe("SnapshotKeyStore", () => {
  it("does not create a key when only reading", async () => {
    await withScratch(async (root) => {
      const store = new SnapshotKeyStore(join(root, "home"));
      expect(await store.readKey()).toBeUndefined();
      await expect(stat(join(root, "home", SNAPSHOT_KEY_FILE_NAME))).rejects.toThrow();
    });
  });

  it("creates one 32-byte key and returns it on every later call", async () => {
    await withScratch(async (root) => {
      const store = new SnapshotKeyStore(join(root, "home"));
      const created = await store.getOrCreateKey();
      expect(created.length).toBe(32);
      expect((await store.getOrCreateKey()).equals(created)).toBe(true);
      expect((await new SnapshotKeyStore(join(root, "home")).readKey())?.equals(created)).toBe(true);
    });
  });

  it("converges on a single key under concurrent first use", async () => {
    await withScratch(async (root) => {
      const directory = join(root, "home");
      const keys = await Promise.all(Array.from({ length: 8 }, () => new SnapshotKeyStore(directory).getOrCreateKey()));
      expect(new Set(keys.map((key) => key.toString("hex"))).size).toBe(1);
    });
  });

  it("refuses a corrupt key instead of trusting or overwriting it", async () => {
    await withScratch(async (root) => {
      const directory = join(root, "home");
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, SNAPSHOT_KEY_FILE_NAME), Buffer.alloc(7));
      const store = new SnapshotKeyStore(directory);
      await expect(store.readKey()).rejects.toThrow();
      await expect(store.getOrCreateKey()).rejects.toThrow();
      expect((await readFile(join(directory, SNAPSHOT_KEY_FILE_NAME))).length).toBe(7);
    });
  });
});

describe("discovery manifest MAC", () => {
  it("verifies an untouched manifest and rejects any material change or another key", async () => {
    await withScratch(async (root) => {
      const key = await new SnapshotKeyStore(join(root, "home")).getOrCreateKey();
      const other = await new SnapshotKeyStore(join(root, "other")).getOrCreateKey();
      const manifest = sign(await createSnapshot(join(root, "p"), join(root, "p")), key);
      expect(verifyManifestMac(manifest, key)).toBe(true);
      expect(verifyManifestMac(manifest, other)).toBe(false);

      const mutations: ((m: any) => void)[] = [
        (m) => { m.artifacts["files.json"].sha256 = "f".repeat(64); },
        (m) => { m.repository.path = join(root, "elsewhere"); },
        (m) => { m.repository.sourceDigest = "0".repeat(64); },
        (m) => { m.analyzer.fingerprint = `lx-analyzer-v1:${"d".repeat(64)}`; },
        (m) => { m.requiredArtifacts = []; },
        (m) => { m.engine.commitSha = "forged"; },
      ];
      for (const mutate of mutations) {
        const changed = structuredClone(manifest);
        mutate(changed);
        expect(verifyManifestMac(changed, key)).toBe(false);
      }
    });
  });
});

describe("DiscoveryValidator reuse authorization", () => {
  async function setup(root: string) {
    const projectPath = join(root, "project");
    const keyDirectory = join(root, "home");
    const key = await new SnapshotKeyStore(keyDirectory).getOrCreateKey();
    const manifest = await createSnapshot(projectPath, await realpath(join(root)).then((r) => join(r, "project")));
    return { projectPath, keyDirectory, key, manifest };
  }

  function validator(
    keyDirectory: string,
    analyzerFingerprint: () => Promise<string | undefined> = async () => FINGERPRINT,
  ): DiscoveryValidator {
    return new DiscoveryValidator(createSnapshotTrust({ keyDirectory, analyzerFingerprint }));
  }

  it("authorizes a signed snapshot from the current analyzer at its canonical location", async () => {
    await withScratch(async (root) => {
      const { projectPath, keyDirectory, key, manifest } = await setup(root);
      await writeManifest(projectPath, sign(manifest, key));
      const result = await validator(keyDirectory).validate({ projectPath, authorizeReuse: true });
      expect(result.status).toBe("VALID");
      expect(result.valid).toBe(true);
    });
  });

  it("keeps integrity-only validation unchanged when reuse authorization is not requested", async () => {
    await withScratch(async (root) => {
      const { projectPath, keyDirectory, manifest } = await setup(root);
      await writeManifest(projectPath, manifest);
      expect((await validator(keyDirectory).validate({ projectPath })).status).toBe("VALID");
    });
  });

  it("rejects an unsigned manifest as UNAUTHENTICATED", async () => {
    await withScratch(async (root) => {
      const { projectPath, keyDirectory, manifest } = await setup(root);
      await writeManifest(projectPath, manifest);
      const result = await validator(keyDirectory).validate({ projectPath, authorizeReuse: true });
      expect(result.valid).toBe(false);
      expect(result.status).toBe("UNAUTHENTICATED");
    });
  });

  it("rejects when no local key exists, without creating one", async () => {
    await withScratch(async (root) => {
      const { projectPath, key, manifest } = await setup(root);
      await writeManifest(projectPath, sign(manifest, key));
      const missingHome = join(root, "missing-home");
      const result = await validator(missingHome).validate({ projectPath, authorizeReuse: true });
      expect(result.status).toBe("UNAUTHENTICATED");
      await expect(stat(missingHome)).rejects.toThrow();
    });
  });

  it("rejects a correctly signed snapshot from another analyzer build as ANALYZER_MISMATCH", async () => {
    await withScratch(async (root) => {
      const { projectPath, keyDirectory, key, manifest } = await setup(root);
      await writeManifest(projectPath, sign(manifest, key, `lx-analyzer-v1:${"e".repeat(64)}`));
      expect((await validator(keyDirectory).validate({ projectPath, authorizeReuse: true })).status).toBe("ANALYZER_MISMATCH");
    });
  });

  it("fails closed when the current analyzer fingerprint is unavailable", async () => {
    await withScratch(async (root) => {
      const { projectPath, keyDirectory, key, manifest } = await setup(root);
      await writeManifest(projectPath, sign(manifest, key));
      expect((await validator(keyDirectory, async () => undefined).validate({ projectPath, authorizeReuse: true })).status).toBe("ANALYZER_MISMATCH");
    });
  });

  it("rejects a signed manifest with a relative repository path as PATH_MISMATCH", async () => {
    await withScratch(async (root) => {
      const { projectPath, keyDirectory, key, manifest } = await setup(root);
      await writeManifest(projectPath, sign({ ...manifest, repository: { ...manifest.repository, path: "." } }, key));
      const originalCwd = process.cwd();
      try {
        process.chdir(projectPath);
        expect((await validator(keyDirectory).validate({ projectPath: ".", authorizeReuse: true })).status).toBe("PATH_MISMATCH");
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  it("refuses a key stored inside the analyzed project", async () => {
    await withScratch(async (root) => {
      const { projectPath, manifest } = await setup(root);
      const insideKeyDirectory = join(projectPath, ".keys");
      const insideKey = await new SnapshotKeyStore(insideKeyDirectory).getOrCreateKey();
      await writeManifest(projectPath, sign(manifest, insideKey));
      expect((await validator(insideKeyDirectory).validate({ projectPath, authorizeReuse: true })).status).toBe("UNAUTHENTICATED");
    });
  });
});

describe("computeAnalyzerFingerprint", () => {
  async function createEngineRoot(root: string): Promise<string> {
    const engineRoot = join(root, "engine");
    await mkdir(join(engineRoot, "src", "nested"), { recursive: true });
    await writeFile(join(engineRoot, "package.json"), JSON.stringify({ name: "engine", version: "1.0.0", dependencies: {} }));
    await writeFile(join(engineRoot, "bun.lock"), "{}\n");
    await writeFile(join(engineRoot, "src", "a.ts"), "export const a = 1;\n");
    await writeFile(join(engineRoot, "src", "nested", "b.ts"), "export const b = 2;\n");
    return engineRoot;
  }

  it("is deterministic and changes when analyzer source changes", async () => {
    await withScratch(async (root) => {
      const engineRoot = await createEngineRoot(root);
      const first = await computeAnalyzerFingerprint(engineRoot);
      expect(first).toMatch(/^lx-analyzer-v1:[a-f0-9]{64}$/);
      expect(await computeAnalyzerFingerprint(engineRoot)).toBe(first);

      await writeFile(join(engineRoot, "src", "nested", "b.ts"), "export const b = 3;\n");
      expect(await computeAnalyzerFingerprint(engineRoot)).not.toBe(first);
    });
  });

  it("ignores generated discovery output inside the analyzer source tree", async () => {
    await withScratch(async (root) => {
      const engineRoot = await createEngineRoot(root);
      const before = await computeAnalyzerFingerprint(engineRoot);
      await mkdir(join(engineRoot, "src", ".discovery"));
      await writeFile(join(engineRoot, "src", ".discovery", "manifest.json"), "{}");
      expect(await computeAnalyzerFingerprint(engineRoot)).toBe(before);
    });
  });

  it("is unavailable when the analyzer source cannot be read", async () => {
    await withScratch(async (root) => {
      expect(await computeAnalyzerFingerprint(join(root, "no-engine"))).toBeUndefined();
    });
  });
});
