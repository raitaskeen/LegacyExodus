import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  SQLITE_SCHEMA_VERSION,
  SqliteStorageProvider,
  StorageSchemaVersionMismatchError,
} from "@storage/index";
import { createStorageRecord } from "@storage/storage-record";

describe("Storage Schema Versioning & Compatibility Guard (F-007)", () => {
  it("1. stamps user_version = 1 and exposes schemaVersion on new database creation", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "legacy-exodus-f007-new-"));
    const dbPath = join(tempDir, "fresh.sqlite");

    try {
      const provider = new SqliteStorageProvider({ databasePath: dbPath });
      expect(provider.schemaVersion).toBe(SQLITE_SCHEMA_VERSION);
      expect(provider.schemaVersion).toBe(1);

      // Verify PRAGMA user_version on underlying database
      const rawDb = new Database(dbPath);
      const pragma = rawDb.query("PRAGMA user_version;").get() as { user_version: number };
      expect(pragma.user_version).toBe(1);
      rawDb.close();

      provider.close();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("2. cleanly opens and reads an existing compatible database with user_version = 1", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "legacy-exodus-f007-compat-"));
    const dbPath = join(tempDir, "compatible.sqlite");

    try {
      // 1. Initial write
      const provider1 = new SqliteStorageProvider({ databasePath: dbPath });
      const record = createStorageRecord("test-type", { name: "preserved" });
      await provider1.save(record);
      provider1.close();

      // 2. Reopen compatible DB
      const provider2 = new SqliteStorageProvider({ databasePath: dbPath });
      const found = await provider2.findById(record.id);
      expect(found).not.toBeNull();
      expect(found?.payload).toEqual({ name: "preserved" });
      provider2.close();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("3. throws StorageSchemaVersionMismatchError when opening database with future schema version", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "legacy-exodus-f007-future-"));
    const dbPath = join(tempDir, "future.sqlite");

    try {
      // Create a database with user_version = 2 (simulating future application release)
      const rawDb = new Database(dbPath, { create: true });
      rawDb.run("PRAGMA user_version = 2;");
      rawDb.close();

      expect(() => new SqliteStorageProvider({ databasePath: dbPath })).toThrow(
        expect.objectContaining({
          name: "StorageSchemaVersionMismatchError",
          code: "STORAGE_SCHEMA_VERSION_MISMATCH",
          metadata: {
            expectedVersion: 1,
            actualVersion: 2,
          },
        }),
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("4. throws StorageSchemaVersionMismatchError when opening database with foreign/unsupported version", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "legacy-exodus-f007-foreign-"));
    const dbPath = join(tempDir, "foreign.sqlite");

    try {
      const rawDb = new Database(dbPath, { create: true });
      rawDb.run("PRAGMA user_version = 99;");
      rawDb.close();

      expect(() => new SqliteStorageProvider({ databasePath: dbPath })).toThrow(
        StorageSchemaVersionMismatchError,
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("5. in-memory sqlite provider initializes user_version = 1 consistently", () => {
    const memProvider = new SqliteStorageProvider({ inMemory: true });
    expect(memProvider.schemaVersion).toBe(SQLITE_SCHEMA_VERSION);
    memProvider.close();
  });
});
