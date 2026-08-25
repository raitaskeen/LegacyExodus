import { StorageRecordNotFoundError } from "../storage-errors";
import {
  extractRecordMetadata,
  type SerializedPayload,
  type StorageRecord,
  validateStorageRecord,
} from "../storage-record";
import type { StorageProvider, StorageQueryCriteria } from "../storage-provider";

export class MemoryStorageProvider implements StorageProvider {
  private readonly records = new Map<string, StorageRecord>();

  public async save<Payload extends SerializedPayload>(record: StorageRecord<Payload>): Promise<void> {
    const validatedRecord = validateStorageRecord(record);

    this.records.set(validatedRecord.id, validatedRecord);
  }

  public async findById<Payload extends SerializedPayload>(
    id: string,
  ): Promise<StorageRecord<Payload> | null> {
    const record = this.records.get(id);

    return record === undefined ? null : (record as StorageRecord<Payload>);
  }

  public async findAll<Payload extends SerializedPayload>(
    type: string,
  ): Promise<StorageRecord<Payload>[]> {
    return this.findScoped<Payload>({ type });
  }

  public async findScoped<Payload extends SerializedPayload>(
    criteria: StorageQueryCriteria,
  ): Promise<StorageRecord<Payload>[]> {
    const results: StorageRecord<Payload>[] = [];

    for (const record of this.records.values()) {
      if (record.type !== criteria.type) {
        continue;
      }

      const meta = extractRecordMetadata(record.payload);

      if (criteria.projectId !== undefined && meta.projectId !== criteria.projectId) {
        continue;
      }

      if (criteria.analysisRunId !== undefined && meta.analysisRunId !== criteria.analysisRunId) {
        continue;
      }

      if (criteria.filePath !== undefined && meta.filePath !== criteria.filePath) {
        continue;
      }

      results.push(record as StorageRecord<Payload>);
    }

    return results;
  }

  public async delete(id: string): Promise<void> {
    if (!this.records.delete(id)) {
      throw new StorageRecordNotFoundError(id);
    }
  }

  public async clear(): Promise<void> {
    this.records.clear();
  }

  public close(): void {
    // In-memory storage has no external file descriptors or persistent handles to release
  }
}
