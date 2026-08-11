import { randomUUID } from "node:crypto";

export type Immutable<Value> = Value extends (...arguments_: never[]) => unknown
  ? Value
  : Value extends readonly (infer Item)[]
    ? ReadonlyArray<Immutable<Item>>
    : Value extends object
      ? { readonly [Key in keyof Value]: Immutable<Value[Key]> }
      : Value;

export interface DomainEvent<Payload = unknown, Type extends string = string> {
  readonly id: string;
  readonly type: Type;
  readonly timestamp: Date;
  readonly aggregateId: string;
  readonly payload: Immutable<Payload>;
}

export interface DomainEventInput<Payload, Type extends string = string> {
  readonly type: Type;
  readonly aggregateId: string;
  readonly payload: Payload;
}

export function createDomainEvent<Payload, Type extends string>(
  input: DomainEventInput<Payload, Type>,
): DomainEvent<Payload, Type> {
  const timestamp = new Date();

  return deepFreeze({
    id: randomUUID(),
    type: input.type,
    get timestamp(): Date {
      return new Date(timestamp);
    },
    aggregateId: input.aggregateId,
    payload: deepFreeze(input.payload),
  }) as DomainEvent<Payload, Type>;
}

function deepFreeze<Value>(value: Value, seen: WeakSet<object> = new WeakSet<object>()): Immutable<Value> {
  if (value === null || typeof value !== "object") {
    return value as Immutable<Value>;
  }

  if (seen.has(value)) {
    return value as Immutable<Value>;
  }

  seen.add(value);

  for (const nestedValue of Object.values(value)) {
    deepFreeze(nestedValue, seen);
  }

  return Object.freeze(value) as Immutable<Value>;
}
