import { createHash, type Hash } from "node:crypto";

import { z } from "zod";

import { StorageValidationError } from "./storage-errors";

export interface SerializedObject {
  readonly [key: string]: unknown;
}

export interface SerializedArray extends ReadonlyArray<unknown> {}

export type SerializedPayload = unknown;

export interface StorageRecord<Payload extends SerializedPayload = SerializedPayload> {
  readonly id: string;
  readonly type: string;
  readonly payload: Payload;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const storageRecordSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  type: z.string().trim().min(1),
  payload: z.unknown(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export function createStorageRecord<Payload extends SerializedPayload>(
  type: string,
  payload: Payload,
): StorageRecord<Payload> {
  const createdAt = new Date();
  const updatedAt = new Date(createdAt.getTime());
  const id = contentIdentity(type, payload);
  const frozenPayload = deepFreeze(structuredClone(payload));

  return validateStorageRecord({
    id,
    type,
    payload: frozenPayload,
    createdAt,
    updatedAt,
  });
}

/** Stable content identity; timestamps remain observability metadata only. */
function contentIdentity(type: string, payload: SerializedPayload): string {
  const hash = createHash("sha256");
  updateCanonicalHash(hash, { payload, type });
  return hash.digest("hex");
}

function updateCanonicalHash(hash: Hash, value: SerializedPayload | SerializedObject): void {
  if (value === null || typeof value !== "object") {
    hash.update(JSON.stringify(value) ?? "null");
    return;
  }

  if (Array.isArray(value)) {
    hash.update("[");
    for (let i = 0; i < value.length; i++) {
      if (i > 0) hash.update(",");
      updateCanonicalHash(hash, value[i] as SerializedPayload);
    }
    hash.update("]");
    return;
  }

  const object = value as SerializedObject;
  const keys = Object.keys(object).sort();
  hash.update("{");
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    if (i > 0) hash.update(",");
    hash.update(JSON.stringify(key));
    hash.update(":");
    updateCanonicalHash(hash, object[key] ?? null);
  }
  hash.update("}");
}

export function validateStorageRecord<Payload extends SerializedPayload>(
  record: StorageRecord<Payload>,
): StorageRecord<Payload> {
  const parsedRecord = storageRecordSchema.safeParse(record);

  if (!parsedRecord.success) {
    throw new StorageValidationError("Storage record is invalid.", {
      issues: parsedRecord.error.issues,
    });
  }

  if (record.updatedAt < record.createdAt) {
    throw new StorageValidationError("Storage record updatedAt must not precede createdAt.");
  }

  if (Object.isFrozen(record) && Object.isFrozen(record.payload)) {
    return record;
  }

  return Object.freeze({
    id: record.id,
    type: record.type,
    payload: deepFreeze(record.payload),
    createdAt: new Date(record.createdAt.getTime()),
    updatedAt: new Date(record.updatedAt.getTime()),
  });
}

export function cloneStorageRecord<Payload extends SerializedPayload>(
  record: StorageRecord<Payload>,
): StorageRecord<Payload> {
  return Object.freeze({
    id: record.id,
    type: record.type,
    payload: deepFreeze(structuredClone(record.payload)),
    createdAt: new Date(record.createdAt.getTime()),
    updatedAt: new Date(record.updatedAt.getTime()),
  });
}

function deepFreeze<Payload extends SerializedPayload>(payload: Payload): Payload {
  if (payload === null || typeof payload !== "object" || Object.isFrozen(payload)) {
    return payload;
  }

  for (const value of Object.values(payload) as SerializedPayload[]) {
    deepFreeze(value);
  }

  return Object.freeze(payload) as Payload;
}
