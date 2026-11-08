import { z } from "zod";

import type { StorageManager, StorageRecord } from "@storage/index";
import { createStorageRecord, deepFreeze } from "@storage/index";

import type { DomainEvent } from "./domain-event";
import { compareCodePoints } from "@shared/ordering";
import { immutable } from "@shared/immutability";

export const DURABLE_EVENT_RECORD_TYPE = "domain-event";

interface DurableEventPayload {
  readonly projectId: string;
  readonly analysisRunId?: string;
  readonly sequence: number;
  readonly event: {
    readonly id: string;
    readonly type: string;
    readonly timestamp: string;
    readonly aggregateId: string;
    readonly payload: unknown;
  };
}

const durableEventPayloadSchema = z.object({
  projectId: z.string().min(1),
  analysisRunId: z.string().uuid().optional(),
  sequence: z.number().int().nonnegative(),
  event: z.object({
    id: z.string().uuid(),
    type: z.string().min(1),
    timestamp: z.string().datetime(),
    aggregateId: z.string().min(1),
    payload: z.unknown(),
  }).strict(),
}).strict();

/** Creates a durable, ordered journal entry for an already-created domain event. */
export function createDurableEventRecord(
  event: DomainEvent,
  sequence: number,
  analysisRunId?: string,
): StorageRecord<DurableEventPayload> {
  return createStorageRecord(DURABLE_EVENT_RECORD_TYPE, {
    projectId: event.aggregateId,
    ...(analysisRunId === undefined ? {} : { analysisRunId }),
    sequence,
    event: {
      id: event.id,
      type: event.type,
      timestamp: event.timestamp.toISOString(),
      aggregateId: event.aggregateId,
      payload: event.payload,
    },
  });
}

/** Retrieves the next available durable sequence number for an aggregate in storage. */
export async function getNextDurableSequence(
  storage: StorageManager,
  projectId: string,
): Promise<number> {
  const records = await storage.findScoped({
    type: DURABLE_EVENT_RECORD_TYPE,
    projectId,
  });

  if (records.length === 0) {
    return 0;
  }

  let max = -1;
  for (const record of records) {
    const payload = record.payload as { readonly sequence?: unknown };
    if (typeof payload.sequence === "number" && payload.sequence > max) {
      max = payload.sequence;
    }
  }

  return max + 1;
}

/** Loads the durable event history for one aggregate in its committed order. */
export async function loadDurableEvents(
  storage: StorageManager,
  projectId: string,
  analysisRunId?: string,
): Promise<readonly DomainEvent[]> {
  const records = await storage.findScoped({
    type: DURABLE_EVENT_RECORD_TYPE,
    projectId,
    ...(analysisRunId === undefined ? {} : { analysisRunId }),
  });

  const parsed = records.map((record) => durableEventPayloadSchema.parse(record.payload));
  parsed.sort((left, right) =>
    left.sequence - right.sequence ||
    compareCodePoints(left.event.timestamp, right.event.timestamp) ||
    compareCodePoints(left.event.id, right.event.id),
  );

  return immutable(parsed.map((entry) => deepFreeze({
    id: entry.event.id,
    type: entry.event.type,
    timestamp: new Date(entry.event.timestamp),
    aggregateId: entry.event.aggregateId,
    payload: entry.event.payload,
  }) as DomainEvent));
}
