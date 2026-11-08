import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SqliteStorageProvider } from "@storage/adapters/sqlite-storage";
import { StorageBusyError } from "@storage/storage-errors";

/**
 * NA-08: another process holding the database's lock. A second `analyze` opening the same
 * `--storage-path` must wait for it (the busy timeout applies before WAL is switched on), and
 * past the timeout fail with a classified STORAGE_BUSY error, not an unexpected SQLiteError.
 */

let directory: string | undefined;
afterEach(() => {
  if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

/** A separate process that holds an exclusive lock on a new database for `holdMs`, then commits. */
async function holdExclusiveLock(databasePath: string, holdMs: number): Promise<{ readonly done: Promise<number> }> {
  const script = [
    "const { Database } = require('bun:sqlite');",
    "const db = new Database(process.argv[1], { create: true });",
    "db.run('CREATE TABLE IF NOT EXISTS holder (x INTEGER)');",
    "db.run('BEGIN EXCLUSIVE');",
    "db.run('INSERT INTO holder VALUES (1)');",
    "console.log('locked');",
    `Bun.sleepSync(${holdMs});`,
    "db.run('COMMIT');",
    "db.close();",
  ].join("\n");
  const child = Bun.spawn([process.execPath, "-e", script, databasePath], { stdout: "pipe", stderr: "inherit" });
  const reader = child.stdout.getReader();
  let output = "";
  while (!output.includes("locked")) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`lock holder exited before locking: ${output}`);
    output += new TextDecoder().decode(value);
  }
  reader.releaseLock();
  return { done: child.exited };
}

describe("NA-08 SQLite storage under another process's lock", () => {
  it("waits for the lock instead of failing at once when opening a database another process is writing", async () => {
    directory = mkdtempSync(join(tmpdir(), "lx-sqlite-busy-"));
    const databasePath = join(directory, "shared.db");
    const holder = await holdExclusiveLock(databasePath, 600);

    const started = performance.now();
    const provider = new SqliteStorageProvider({ databasePath });
    const waitedMs = performance.now() - started;
    provider.close();

    expect(await holder.done).toBe(0);
    expect(waitedMs).toBeGreaterThan(200);
  });

  it("fails with a classified STORAGE_BUSY error once the lock outlasts the busy timeout", async () => {
    directory = mkdtempSync(join(tmpdir(), "lx-sqlite-busy-"));
    const databasePath = join(directory, "shared.db");
    const holder = await holdExclusiveLock(databasePath, 1500);

    let thrown: unknown;
    try {
      new SqliteStorageProvider({ databasePath, busyTimeoutMs: 100 }).close();
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(StorageBusyError);
    expect((thrown as StorageBusyError).code).toBe("STORAGE_BUSY");
    expect(await holder.done).toBe(0);
  });
});
