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
