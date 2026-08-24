import type { SerializedPayload, StorageRecord } from "./storage-record";

export interface StorageProvider {
  readonly isPersistent?: boolean;
  save<Payload extends SerializedPayload>(record: StorageRecord<Payload>): Promise<void>;
  findById<Payload extends SerializedPayload>(id: string): Promise<StorageRecord<Payload> | null>;
  findAll<Payload extends SerializedPayload>(type: string): Promise<StorageRecord<Payload>[]>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
  close?(): Promise<void> | void;
}
