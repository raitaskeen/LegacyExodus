import type { SerializedPayload, StorageRecord } from "./storage-record";
import type { CommitBatchOptions, StorageProvider, StorageQueryCriteria } from "./storage-provider";

export class StorageManager {
  public constructor(private readonly provider: StorageProvider) {}

  public save<Payload extends SerializedPayload>(record: StorageRecord<Payload>): Promise<void> {
    return this.provider.save(record);
  }

  public async saveBatch(records: readonly StorageRecord[]): Promise<void> {
    if (this.provider.saveBatch) {
      await this.provider.saveBatch(records);
    } else {
      for (const record of records) {
        await this.provider.save(record);
      }
    }
  }

  public async commitBatch(options: CommitBatchOptions): Promise<readonly StorageRecord[]> {
    if (this.provider.commitBatch) {
      return this.provider.commitBatch(options);
    }

    const events = options.events ?? [];
    const nextSeqByAgg = new Map<string, number>();
    const durableRecords: StorageRecord[] = [];

    for (const eventItem of events) {
      let seq = nextSeqByAgg.get(eventItem.aggregateId);
      if (seq === undefined) {
        const records = await this.findScoped({ type: "domain-event", projectId: eventItem.aggregateId });
        let max = -1;
        for (const record of records) {
          const payload = record.payload as { readonly sequence?: unknown };
          if (typeof payload.sequence === "number" && payload.sequence > max) {
            max = payload.sequence;
          }
        }
        seq = max + 1;
      }
      const record = eventItem.createRecord(seq);
      durableRecords.push(record);
      nextSeqByAgg.set(eventItem.aggregateId, seq + 1);
    }

    await this.saveBatch([...options.records, ...durableRecords]);
    return durableRecords;
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
