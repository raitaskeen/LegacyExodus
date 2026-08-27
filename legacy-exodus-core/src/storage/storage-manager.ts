import type { SerializedPayload, StorageRecord } from "./storage-record";
import type { StorageProvider, StorageQueryCriteria } from "./storage-provider";

export class StorageManager {
  public constructor(private readonly provider: StorageProvider) {}

  public save<Payload extends SerializedPayload>(record: StorageRecord<Payload>): Promise<void> {
    return this.provider.save(record);
  }

  public async saveBatch<Payload extends SerializedPayload>(
    records: readonly StorageRecord<Payload>[],
  ): Promise<void> {
    if (this.provider.saveBatch) {
      await this.provider.saveBatch(records);
    } else {
      for (const record of records) {
        await this.provider.save(record);
      }
    }
  }

  public findById<Payload extends SerializedPayload>(
    id: string,
  ): Promise<StorageRecord<Payload> | null> {
    return this.provider.findById<Payload>(id);
  }

  public findAll<Payload extends SerializedPayload>(
    type: string,
  ): Promise<StorageRecord<Payload>[]> {
    return this.provider.findAll<Payload>(type);
  }

  public findScoped<Payload extends SerializedPayload>(
    criteria: StorageQueryCriteria,
  ): Promise<StorageRecord<Payload>[]> {
    return this.provider.findScoped(criteria);
  }

  public delete(id: string): Promise<void> {
    return this.provider.delete(id);
  }

  public isPersistent(): boolean {
    return this.provider.isPersistent ?? false;
  }

  public clear(): Promise<void> {
    return this.provider.clear();
  }

  public async close(): Promise<void> {
    await this.provider.close?.();
  }
}
