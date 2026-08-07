import { StorageRecordNotFoundError } from "../storage-errors";
import {
  cloneStorageRecord,
  type SerializedPayload,
  type StorageRecord,
  validateStorageRecord,
} from "../storage-record";
import type { StorageProvider } from "../storage-provider";

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

    return record === undefined ? null : cloneStorageRecord(record) as StorageRecord<Payload>;
  }

  public async findAll<Payload extends SerializedPayload>(
    type: string,
  ): Promise<StorageRecord<Payload>[]> {
    return [...this.records.values()]
      .filter((record) => record.type === type)
      .map((record) => cloneStorageRecord(record) as StorageRecord<Payload>);
  }

  public async delete(id: string): Promise<void> {
    if (!this.records.delete(id)) {
      throw new StorageRecordNotFoundError(id);
    }
  }

  public async clear(): Promise<void> {
    this.records.clear();
  }
}
