import type { SerializedPayload, StorageRecord } from "./storage-record";
import type { StorageProvider } from "./storage-provider";

export class StorageManager {
  public constructor(private readonly provider: StorageProvider) {}

  public save<Payload extends SerializedPayload>(record: StorageRecord<Payload>): Promise<void> {
    return this.provider.save(record);
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

  public delete(id: string): Promise<void> {
    return this.provider.delete(id);
  }

  public clear(): Promise<void> {
    return this.provider.clear();
  }
}
