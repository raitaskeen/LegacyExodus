import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const MANIFEST_MAC_ALGORITHM = "hmac-sha256";
const MANIFEST_MAC_DOMAIN = "legacy-exodus/discovery-manifest/v1\n";
const LOCATION_DIGEST_DOMAIN = "legacy-exodus/discovery-location/v1\n";
/** 2: the project location is a keyed digest, never a plaintext path (BA-26). */
// 3: fact artifacts carry no run identity (ADR-010); older snapshots are refused and analysed again.
/** 4: calls and call references can be EXTERNAL (ADR-012). */
export const MANIFEST_SCHEMA_VERSION = 4;

export const discoveryManifestSchema = z.object({
  schemaVersion: z.number().int().positive(),
  repository: z.object({
    name: z.string().min(1),
    /** Keyed digest of the canonical project path; absent when no local snapshot key was usable. */
    locationDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    packageVersion: z.string().optional(),
    commitSha: z.string().optional(),
    sourceDigest: z.string().optional(),
  }),
  engine: z.object({
    packageVersion: z.string(),
    commitSha: z.string(),
    bunVersion: z.string(),
  }),
  analysis: z.object({
    projectId: z.string(),
    analysisRunId: z.string().optional(),
    generatedAt: z.string(),
  }),
  requiredArtifacts: z.array(z.string()),
  artifacts: z.record(
    z.string(),
    z.object({
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      bytes: z.number().nonnegative(),
    }),
  ),
  /** Identity of the analyzer build that produced the artifacts. */
  analyzer: z.object({ fingerprint: z.string().min(1) }).optional(),
  /** Local-key authentication of every other manifest field (and so of every artifact hash). */
  integrity: z.object({
    algorithm: z.string(),
    keyId: z.string(),
    mac: z.string(),
  }).optional(),
});

export type DiscoveryManifest = z.infer<typeof discoveryManifestSchema>;

/**
 * Binds a snapshot to its canonical project location without recording the path: a shared
 * `.discovery` reveals no user name or directory layout, and only the local key can confirm it.
 */
export function manifestLocationDigest(canonicalProjectPath: string, key: Buffer): string {
  return createHmac("sha256", key).update(LOCATION_DIGEST_DOMAIN).update(canonicalProjectPath).digest("hex");
}

/** Short public identifier of a snapshot key; never reveals the key itself. */
export function manifestKeyId(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

/**
 * Authenticates a manifest with a local snapshot key.
 *
 * The MAC covers the canonical encoding of every schema field except `integrity`,
 * so it binds the repository location, source digest, analyzer identity and each
 * artifact hash. Unknown fields are not part of the manifest contract and are ignored.
 */
export function computeManifestMac(manifest: DiscoveryManifest, key: Buffer): string {
  const authenticated: DiscoveryManifest = { ...discoveryManifestSchema.parse(manifest) };
  delete authenticated.integrity;
  return createHmac("sha256", key).update(MANIFEST_MAC_DOMAIN).update(canonicalJson(authenticated)).digest("hex");
}

export function verifyManifestMac(manifest: DiscoveryManifest, key: Buffer): boolean {
  const integrity = manifest.integrity;
  if (integrity === undefined || integrity.algorithm !== MANIFEST_MAC_ALGORITHM || integrity.keyId !== manifestKeyId(key)) {
    return false;
  }
  if (!/^[a-f0-9]{64}$/.test(integrity.mac)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(integrity.mac, "hex"), Buffer.from(computeManifestMac(manifest, key), "hex"));
}

/** Deterministic JSON with code-unit key order; `undefined` members are omitted as JSON.stringify does. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const members = Object.keys(value)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
    return `{${members.join(",")}}`;
  }
  return JSON.stringify(value);
}
