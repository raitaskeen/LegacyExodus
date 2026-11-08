import { createHmac, randomUUID } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";

import { isPhysicallyContained, physicalPath, type SnapshotKeyStore } from "./snapshot-trust";

/** Where `legacy-exodus init` records the workspace's metadata, including its project id. */
export const WORKSPACE_CONFIG_PATH = [".legacy-exodus", "config.json"] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CONFIG_BYTES = 64 * 1024;

/**
 * A stable project id for the repository at `projectPath` (ADR-010 step 2). In order:
 * 1. the `projectId` that `init` wrote into `.legacy-exodus/config.json`, when it is a plain file holding a UUID;
 * 2. a UUID derived as HMAC(snapshot key, canonical path): stable on this machine, and no path leaves it;
 * 3. a random UUID, when the key cannot be used (it lives inside the project, or cannot be read or created).
 * The id names the repository, never its content, so it is never written into fact artifacts.
 */
export async function resolveProjectId(projectPath: string, keyStore: SnapshotKeyStore): Promise<string> {
  let canonical: string;
  try {
    canonical = await realpath(projectPath);
  } catch {
    return randomUUID();
  }
  const configured = await configuredProjectId(canonical);
  if (configured !== undefined) return configured;

  const keyDirectory = await physicalPath(keyStore.directory);
  if (keyDirectory === canonical || isPhysicallyContained(canonical, keyDirectory)) return randomUUID();
  let key: Buffer;
  try {
    key = await keyStore.getOrCreateKey();
  } catch {
    return randomUUID();
  }
  return uuidFromDigest(createHmac("sha256", key).update("legacy-exodus/project-id\0").update(canonical).digest());
}

/** The configured id, or `undefined`; the config is repository content, so anything but a plain file with a UUID is ignored. */
async function configuredProjectId(canonical: string): Promise<string | undefined> {
  const directory = join(canonical, WORKSPACE_CONFIG_PATH[0]);
  const file = join(directory, WORKSPACE_CONFIG_PATH[1]);
  try {
    const [directoryStats, fileStats] = [await lstat(directory), await lstat(file)];
    if (!directoryStats.isDirectory() || !fileStats.isFile() || fileStats.size > MAX_CONFIG_BYTES) return undefined;
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    const id = typeof parsed === "object" && parsed !== null ? (parsed as { readonly projectId?: unknown }).projectId : undefined;
    return typeof id === "string" && UUID.test(id) ? id.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

/** An RFC 9562 version-8 UUID from the first 16 bytes of `digest`. */
function uuidFromDigest(digest: Buffer): string {
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
