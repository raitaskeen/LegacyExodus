export {
  MemoryStorageProvider,
} from "./adapters/memory-storage";
export {
  SqliteStorageProvider,
  SQLITE_SCHEMA_VERSION,
  type SqliteStorageOptions,
} from "./adapters/sqlite-storage";
export {
  StorageError,
  StorageRecordNotFoundError,
  StorageSchemaVersionMismatchError,
  StorageValidationError,
} from "./storage-errors";
export { StorageManager } from "./storage-manager";
export { DiscoveryProjectionService } from "./projections/discovery-projection-service";
export {
  FileDiscoveryProjectionAdapter,
  resolveGitCommitSha,
} from "./projections/file-discovery-projection";
export {
  cloneStorageRecord,
  createStorageRecord,
  deepFreeze,
  extractRecordMetadata,
  validateStorageRecord,
  type SerializedPayload,
  type StorageRecord,
  type StorageRecordMetadata,
} from "./storage-record";
export type { StorageProvider, StorageQueryCriteria } from "./storage-provider";
