import type { SerializedPayload, StorageRecord } from "./storage-record";

export interface StorageQueryCriteria {
  readonly type: string;
  readonly projectId?: string;
  readonly analysisRunId?: string;
  readonly filePath?: string;
}

export interface EventBatchItem {
  readonly aggregateId: string;
  readonly createRecord: (sequence: number) => StorageRecord;
}

export interface CommitBatchOptions {
  readonly records: readonly StorageRecord[];
  readonly events?: readonly EventBatchItem[];
}

export interface StorageProvider {
  readonly isPersistent?: boolean;
  save<Payload extends SerializedPayload>(record: StorageRecord<Payload>): Promise<void>;
  saveBatch?(records: readonly StorageRecord[]): Promise<void>;
  commitBatch?(options: CommitBatchOptions): Promise<readonly StorageRecord[]>;
  findById<Payload extends SerializedPayload>(id: string): Promise<StorageRecord<Payload> | null>;
  findAll<Payload extends SerializedPayload>(type: string): Promise<StorageRecord<Payload>[]>;
  findScoped<Payload extends SerializedPayload>(criteria: StorageQueryCriteria): Promise<StorageRecord<Payload>[]>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
  close?(): Promise<void> | void;
}
