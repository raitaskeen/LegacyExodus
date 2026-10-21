import { randomBytes, randomUUID } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { getAnalyzerFingerprint } from "@runtime/analyzer-fingerprint";
import { LegacyExodusError } from "@shared/errors";

export const SNAPSHOT_KEY_FILE_NAME = "snapshot-hmac.key";
export const SNAPSHOT_KEY_BYTES = 32;

/** `LEGACY_EXODUS_HOME` when set, otherwise `~/.legacy-exodus`. */
export function defaultSnapshotKeyDirectory(environment: Readonly<Record<string, string | undefined>> = process.env): string {
  const configured = environment.LEGACY_EXODUS_HOME?.trim();
  return resolve(configured !== undefined && configured.length > 0 ? configured : join(homedir(), ".legacy-exodus"));
}

/**
 * Machine-local secret used to authenticate `.discovery` manifests.
 *
 * The key lives outside analyzed repositories, so repository content cannot
 * produce a snapshot that this analyzer will accept for reuse.
 */
export class SnapshotKeyStore {
  public readonly directory: string;
  public readonly keyPath: string;

  public constructor(directory: string = defaultSnapshotKeyDirectory()) {
    this.directory = resolve(directory);
    this.keyPath = join(this.directory, SNAPSHOT_KEY_FILE_NAME);
  }

  /** Returns the existing key, or `undefined` when none exists. Never creates one. */
  public async readKey(): Promise<Buffer | undefined> {
    let key: Buffer;
    try {
      key = await readFile(this.keyPath);
    } catch (error: unknown) {
      if (errorCode(error) === "ENOENT") return undefined;
      throw keyError("Snapshot key cannot be read.", this.keyPath, error);
    }
    if (key.length !== SNAPSHOT_KEY_BYTES) {
      throw keyError("Snapshot key is not a valid key file.", this.keyPath);
    }
    return key;
  }

  /** Returns the existing key or atomically publishes a new one; an invalid key is never overwritten. */
  public async getOrCreateKey(): Promise<Buffer> {
    const existing = await this.readKey();
    if (existing !== undefined) return existing;

    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
    } catch (error: unknown) {
      throw keyError("Snapshot key directory cannot be created.", this.directory, error);
    }

    const candidate = randomBytes(SNAPSHOT_KEY_BYTES);
    const temporaryPath = join(this.directory, `.${SNAPSHOT_KEY_FILE_NAME}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporaryPath, candidate, { mode: 0o600, flag: "wx" });
      // A hard link publishes the complete key or fails with EEXIST; it never replaces a key.
      await link(temporaryPath, this.keyPath);
    } catch (error: unknown) {
      const code = errorCode(error);
      if (code !== "EEXIST") {
        if (code !== "EPERM" && code !== "ENOTSUP" && code !== "ENOSYS") {
          throw keyError("Snapshot key cannot be created.", this.keyPath, error);
        }
        // Filesystems without hard links: exclusive create still never replaces a key.
        await writeFile(this.keyPath, candidate, { mode: 0o600, flag: "wx" }).catch((fallbackError: unknown) => {
          if (errorCode(fallbackError) !== "EEXIST") throw keyError("Snapshot key cannot be created.", this.keyPath, fallbackError);
        });
      }
    } finally {
      await unlink(temporaryPath).catch(() => {});
    }

    const published = await this.readKey();
    if (published === undefined) {
      throw keyError("Snapshot key is missing after creation.", this.keyPath);
    }
    return published;
  }
}

export interface SnapshotTrust {
  readonly keyStore: SnapshotKeyStore;
  /** Identity of the running analyzer; `undefined` disables snapshot reuse. */
  analyzerFingerprint(): Promise<string | undefined>;
}

export interface SnapshotTrustOptions {
  readonly keyDirectory?: string;
  readonly analyzerFingerprint?: () => Promise<string | undefined>;
}

export function createSnapshotTrust(options: SnapshotTrustOptions = {}): SnapshotTrust {
  return Object.freeze({
    keyStore: new SnapshotKeyStore(options.keyDirectory ?? defaultSnapshotKeyDirectory()),
    analyzerFingerprint: options.analyzerFingerprint ?? (() => getAnalyzerFingerprint()),
  });
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function keyError(message: string, path: string, cause?: unknown): LegacyExodusError {
  return new LegacyExodusError({
    code: "SNAPSHOT_KEY_UNAVAILABLE",
    message,
    metadata: { path },
    ...(cause === undefined ? {} : { cause }),
  });
}
