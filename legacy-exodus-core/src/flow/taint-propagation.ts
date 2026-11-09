import { sortByKey } from "@shared/ordering";
import { immutable } from "@shared/immutability";

/**
 * A taint transfer: whatever reaches the source definition reaches the target. A sanitizing transfer (the
 * value passed through a sanitizer call) marks each source it carries as sanitized (see sanitizedSourceId).
 */
export interface TaintEdge { readonly sourceDefinitionId: string; readonly targetDefinitionId: string; readonly sanitizes?: true }

const SANITIZED = "\u0000sanitized";

/**
 * A source as it is after a sanitizer: still tainted, but clean for the sinks the sanitizer protects
 * (XA-01). The mark travels with the source id through every transfer and is resolved at the sink.
 */
export function sanitizedSourceId(sourceId: string): string {
  return sourceId.endsWith(SANITIZED) ? sourceId : sourceId + SANITIZED;
}

/** The source id without the sanitized mark, and whether it had one. */
export function unsanitizedSourceId(sourceId: string): { readonly sourceId: string; readonly sanitized: boolean } {
  return sourceId.endsWith(SANITIZED)
    ? { sourceId: sourceId.slice(0, -SANITIZED.length), sanitized: true }
    : { sourceId, sanitized: false };
}
export type TaintPaths = Map<string, Map<string, readonly string[]>>;

/**
 * Records `path` for `sourceId` at `definitionId` when it is acyclic and both shorter and
 * lexicographically smaller than the path already held; returns whether it was recorded.
 */
export function setTaintPath(taintPaths: TaintPaths, definitionId: string, sourceId: string, path: readonly string[]): boolean {
  const paths = taintPaths.get(definitionId) ?? new Map<string, readonly string[]>();
  const existing = paths.get(sourceId);
  // Cheapest rejection first; the outcome is the same in any order.
  if (existing !== undefined && existing.length <= path.length) return false;
  if (path.slice(0, -1).includes(definitionId)) return false;
  if (existing !== undefined && existing.join(":") <= path.join(":")) return false;
  paths.set(sourceId, immutable([...path]));
  taintPaths.set(definitionId, paths);
  return true;
}

/**
 * Propagates taint paths along transfers to their fixed point. The result equals repeated sweeps over
 * the transfers in code-point order, but only a transfer whose source changed is revisited: later
 * dependents in the same sweep, earlier ones in the next (BA-28: the plain sweep re-touched every
 * transfer once per round, which is quadratic or worse on long chains).
 */
export function propagateTaintPaths(transfers: readonly TaintEdge[], taintPaths: TaintPaths): void {
  const ordered = sortByKey(transfers, (transfer) => `${transfer.sourceDefinitionId}:${transfer.targetDefinitionId}`);
  const indexesBySource = new Map<string, number[]>();
  let current: number[] = [];
  let currentQueued = new Set<number>();
  let next: number[] = [];
  let nextQueued = new Set<number>();
  for (const [index, transfer] of ordered.entries()) {
    const dependents = indexesBySource.get(transfer.sourceDefinitionId) ?? [];
    dependents.push(index);
    indexesBySource.set(transfer.sourceDefinitionId, dependents);
    if (taintPaths.has(transfer.sourceDefinitionId)) enqueue(current, currentQueued, index);
  }
  while (current.length > 0 || next.length > 0) {
    if (current.length === 0) {
      current = next;
      currentQueued = nextQueued;
      next = [];
      nextQueued = new Set<number>();
    }
    const index = dequeue(current, currentQueued);
    const transfer = ordered[index];
    if (transfer === undefined) continue;
    const sourcePaths = taintPaths.get(transfer.sourceDefinitionId);
    if (sourcePaths === undefined) continue;
    let changed = false;
    const held = taintPaths.get(transfer.targetDefinitionId);
    for (const [heldSourceId, path] of [...sourcePaths]) {
      const sourceId = transfer.sanitizes === true ? sanitizedSourceId(heldSourceId) : heldSourceId;
      // A candidate no shorter than the held path is rejected; skip building it.
      const existing = held?.get(sourceId);
      if (existing !== undefined && existing.length <= path.length + 1) continue;
      if (setTaintPath(taintPaths, transfer.targetDefinitionId, sourceId, [...path, transfer.targetDefinitionId])) changed = true;
    }
    if (!changed) continue;
    for (const dependent of indexesBySource.get(transfer.targetDefinitionId) ?? []) {
      if (dependent > index) enqueue(current, currentQueued, dependent);
      else enqueue(next, nextQueued, dependent);
    }
  }
}

/** Min-heap push of a transfer index, at most once per queue. */
function enqueue(queue: number[], queued: Set<number>, index: number): void {
  if (queued.has(index)) return;
  queued.add(index);
  queue.push(index);
  for (let child = queue.length - 1; child > 0;) {
    const parent = Math.floor((child - 1) / 2);
    const childValue = queue[child];
    const parentValue = queue[parent];
    if (childValue === undefined || parentValue === undefined || parentValue <= childValue) break;
    queue[parent] = childValue;
    queue[child] = parentValue;
    child = parent;
  }
}

function dequeue(queue: number[], queued: Set<number>): number {
  const first = queue[0];
  if (first === undefined) throw new Error("Transfer worklist is unexpectedly empty.");
  const last = queue.pop();
  queued.delete(first);
  if (queue.length === 0 || last === undefined) return first;
  queue[0] = last;
  for (let parent = 0;;) {
    const left = parent * 2 + 1;
    const right = left + 1;
    let smallest = parent;
    if (queue[left] !== undefined && queue[smallest] !== undefined && queue[left]! < queue[smallest]!) smallest = left;
    if (queue[right] !== undefined && queue[smallest] !== undefined && queue[right]! < queue[smallest]!) smallest = right;
    if (smallest === parent) break;
    const parentValue = queue[parent];
    const childValue = queue[smallest];
    if (parentValue === undefined || childValue === undefined) break;
    queue[parent] = childValue;
    queue[smallest] = parentValue;
    parent = smallest;
  }
  return first;
}
