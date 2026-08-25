export { MemoryStorageProvider } from "./adapters/memory-storage";
export { SqliteStorageProvider, type SqliteStorageOptions } from "./adapters/sqlite-storage";
export {
  StorageError,
  StorageRecordNotFoundError,
  StorageValidationError,
} from "./storage-errors";
export { StorageManager } from "./storage-manager";
export { DiscoveryProjectionService } from "./projections/discovery-projection-service";
export { FileDiscoveryProjectionAdapter } from "./projections/file-discovery-projection";
export {
  cloneStorageRecord,
  createStorageRecord,
  extractRecordMetadata,
  validateStorageRecord,
  type SerializedPayload,
  type StorageRecord,
  type StorageRecordMetadata,
} from "./storage-record";
export type { StorageProvider, StorageQueryCriteria } from "./storage-provider";
