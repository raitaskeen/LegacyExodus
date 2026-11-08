import { LegacyExodusError, type ErrorMetadata } from "@shared/errors";

export class StorageError extends LegacyExodusError {
  public constructor(code: string, message: string, metadata: ErrorMetadata = {}) {
    super({ code, message, metadata });

    this.name = "StorageError";
  }
}

export class StorageRecordNotFoundError extends StorageError {
  public constructor(id: string) {
    super("STORAGE_RECORD_NOT_FOUND", "Storage record was not found.", { id });

    this.name = "StorageRecordNotFoundError";
  }
}

export class StorageValidationError extends StorageError {
  public constructor(message: string, metadata: ErrorMetadata = {}) {
    super("STORAGE_RECORD_INVALID", message, metadata);

    this.name = "StorageValidationError";
  }
}

export class StorageSchemaVersionMismatchError extends StorageError {
  public constructor(expectedVersion: number, actualVersion: number) {
    super(
      "STORAGE_SCHEMA_VERSION_MISMATCH",
      `Storage schema version mismatch: expected schema version ${expectedVersion}, found version ${actualVersion}.`,
      { expectedVersion, actualVersion },
    );

    this.name = "StorageSchemaVersionMismatchError";
  }
}

/** Another process held the database's lock for longer than the busy timeout (NA-08). */
export class StorageBusyError extends StorageError {
  public constructor(databasePath: string, sqliteCode: string) {
    super(
      "STORAGE_BUSY",
      "The storage database is locked by another process (for example a second analysis writing to the same file). Retry when it finishes, or give each concurrent run its own --storage-path.",
      { databasePath, sqliteCode },
    );

    this.name = "StorageBusyError";
  }
}
