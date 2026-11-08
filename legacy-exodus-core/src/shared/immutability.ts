/**
 * Facts are immutable (DAT-01). Objects are always frozen. A frozen array, though, costs the runtime (JSC) a
 * hash map of its own: it moves to array storage with a sparse value map, 273 bytes instead of 113 for a
 * one-item array, and analysis holds about 28 of them per file. So arrays are frozen only where a mutation
 * must fail at once, in tests and CI (`NODE_ENV=test`) or with `LEGACY_EXODUS_FREEZE_ARRAYS=1`; elsewhere
 * they are read-only by type and recorded as immutable, and `isImmutable` answers as `Object.isFrozen` would.
 * Output is the same either way: freezing computes nothing.
 */
export const FREEZE_ARRAYS = process.env.NODE_ENV === "test" || process.env.LEGACY_EXODUS_FREEZE_ARRAYS === "1";

const immutableArrays = new WeakSet<object>();

/** `Object.freeze`, except that an array is frozen only when `FREEZE_ARRAYS`. */
export const immutable = ((value: unknown): unknown => {
  if (!FREEZE_ARRAYS && Array.isArray(value)) {
    immutableArrays.add(value);
    return value;
  }
  return Object.freeze(value);
}) as typeof Object.freeze;

/** `Object.isFrozen` for values made immutable by `immutable`. */
export function isImmutable(value: unknown): boolean {
  return !FREEZE_ARRAYS && Array.isArray(value) ? immutableArrays.has(value) : Object.isFrozen(value);
}
