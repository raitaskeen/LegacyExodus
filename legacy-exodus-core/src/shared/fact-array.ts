import { createHash, type Hash } from "node:crypto";
import { closeSync, mkdtempSync, openSync, readSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compareCodePoints, sortByKey } from "./ordering";
import { immutable } from "@shared/immutability";

const CHUNK_BYTES = 1 << 20;
const STORE_PREFIX = "legacy-exodus-facts-";

/** A byte range of a fact file holding `length` items, each passed through `transform` as it is read. */
interface Segment {
  readonly path: string;
  readonly start: number;
  readonly end: number;
  readonly length: number;
  readonly transform: ((item: unknown) => unknown) | undefined;
}

/**
 * A frozen list of facts kept on disk, one JSON document per line (ADR-009 step 1). Iterating reads and parses
 * one item at a time, so a whole-repository fact list is never in memory at once. `JSON.stringify` of it
 * (SQLite storage) materializes it. Items are written by `FactArrayWriter`, in order, and never change.
 */
export class FactArray<T> implements Iterable<T> {
  readonly #segments: readonly Segment[];

  private constructor(segments: readonly Segment[], public readonly length: number, public readonly sha256: string) {
    this.#segments = segments;
    immutable(this);
  }

  /** @internal The list a writer sealed. */
  public static sealed<T>(path: string, start: number, end: number, length: number, sha256: string): FactArray<T> {
    return new FactArray<T>([{ path, start, end, length, transform: undefined }], length, sha256);
  }

  /** The items of `lists`, one list after another, read from where they lie (no copy). */
  public static concat<T>(lists: readonly FactArray<T>[]): FactArray<T> {
    const digest = createHash("sha256");
    for (const list of lists) digest.update(`${list.sha256}:${list.length}\n`);
    return new FactArray<T>(lists.flatMap((list) => list.#segments), lists.reduce((total, list) => total + list.length, 0), digest.digest("hex"));
  }

  /** A view of the same items, each passed through `transform` as it is read. */
  public map<U>(transform: (item: T) => U): FactArray<U> {
    return new FactArray<U>(this.#segments.map((segment) => {
      const inner = segment.transform;
      return { ...segment, transform: inner === undefined ? transform as (item: unknown) => unknown : (item: unknown) => transform(inner(item) as T) };
    }), this.length, this.sha256);
  }

  public *[Symbol.iterator](): Iterator<T> {
    for (const segment of this.#segments) yield* read<T>(segment);
  }

  public toJSON(): T[] {
    return [...this];
  }
}

function* read<T>(segment: Segment): Generator<T> {
  const descriptor = openSync(segment.path, "r");
  const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
  const decoder = new TextDecoder();
  let pending = "";
  let read = 0;
  let position = segment.start;
  try {
    for (;;) {
      const bytes = position >= segment.end ? 0 : readSync(descriptor, buffer, 0, Math.min(CHUNK_BYTES, segment.end - position), position);
      position += bytes;
      pending += bytes === 0 ? decoder.decode() : decoder.decode(buffer.subarray(0, bytes), { stream: true });
      let start = 0;
      for (let end = pending.indexOf("\n"); end >= 0; end = pending.indexOf("\n", start)) {
        const item: unknown = JSON.parse(pending.slice(start, end));
        start = end + 1;
        read++;
        yield (segment.transform === undefined ? item : segment.transform(item)) as T;
      }
      pending = pending.slice(start);
      if (bytes === 0) break;
    }
  } finally {
    closeSync(descriptor);
  }
  if (pending.length > 0 || read !== segment.length) throw new Error(`Fact list ${segment.path} holds ${read} items, expected ${segment.length}.`);
}

/** An open fact file; writers append to it one after another, each sealing a list of its own range. */
class FactFile {
  public offset = 0;
  public closed = false;
  public readonly descriptor: number;

  public constructor(public readonly path: string) {
    this.descriptor = openSync(path, "wx");
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    closeSync(this.descriptor);
  }
}

/** Appends facts to one `FactArray`; `seal` writes out what is buffered and returns the list. */
export class FactArrayWriter<T> {
  readonly #file: FactFile;
  readonly #start: number;
  readonly #closeOnSeal: boolean;
  readonly #hash: Hash = createHash("sha256");
  #buffer = "";
  #length = 0;
  #sealed = false;

  /** @internal Writers come from `FactStore.writer` and `FactSpool.writer`. */
  public constructor(file: FactFile, closeOnSeal: boolean, private readonly onClose: () => void = () => {}) {
    this.#file = file;
    this.#start = file.offset;
    this.#closeOnSeal = closeOnSeal;
  }

  /** Closes the file without producing a list. */
  public abandon(): void {
    if (this.#sealed) return;
    this.#sealed = true;
    this.#file.close();
  }

  public append(item: T): void {
    if (this.#sealed) throw new Error("Fact list is sealed.");
    const line = `${JSON.stringify(item)}\n`;
    this.#hash.update(line);
    this.#buffer += line;
    this.#length++;
    if (this.#buffer.length >= CHUNK_BYTES) this.#flush();
  }

  public seal(): FactArray<T> {
    if (this.#sealed) throw new Error("Fact list is sealed.");
    this.#flush();
    this.#sealed = true;
    if (this.#closeOnSeal) this.#file.close();
    this.onClose();
    return FactArray.sealed<T>(this.#file.path, this.#start, this.#file.offset, this.#length, this.#hash.digest("hex"));
  }

  #flush(): void {
    if (this.#buffer.length === 0) return;
    this.#file.offset += writeSync(this.#file.descriptor, this.#buffer, this.#file.offset);
    this.#buffer = "";
  }
}

/**
 * One file many small lists are written to, one list after another: a list per source file (a symbol table)
 * would otherwise be a file per source file. Only one of its writers may be open at a time.
 */
export class FactSpool {
  #open = false;

  /** @internal Spools come from `FactStore.spool`. */
  public constructor(private readonly file: FactFile, private readonly track: (writer: { abandon(): void }) => () => void) {}

  public writer<T>(): FactArrayWriter<T> {
    if (this.#open) throw new Error("A fact spool writes one list at a time.");
    if (this.file.closed) throw new Error("Fact spool is closed.");
    this.#open = true;
    let release = (): void => {};
    const writer = new FactArrayWriter<T>(this.file, false, () => { this.#open = false; release(); });
    release = this.track(writer);
    return writer;
  }

  public close(): void {
    this.file.close();
  }
}

/**
 * The directory fact lists live in. It must outlive every record that references its lists, so its owner
 * disposes it when those records go (engine shutdown), and at the latest the process does on exit.
 */
export class FactStore {
  #next = 0;
  #disposed = false;
  readonly #writers = new Set<{ abandon(): void }>();
  readonly #spools = new Set<FactSpool>();

  private constructor(private readonly directory: string) {}

  public static create(): FactStore {
    const store = new FactStore(mkdtempSync(join(tmpdir(), STORE_PREFIX)));
    if (!exitHookInstalled) {
      exitHookInstalled = true;
      process.on("exit", disposeAllFactStores);
    }
    liveStores.add(store);
    return store;
  }

  public writer<T>(): FactArrayWriter<T> {
    let release = (): void => {};
    const writer: FactArrayWriter<T> = new FactArrayWriter<T>(this.#file(), true, () => release());
    release = this.#track(writer);
    return writer;
  }

  public spool(): FactSpool {
    const spool = new FactSpool(this.#file(), (writer) => this.#track(writer));
    this.#spools.add(spool);
    return spool;
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    liveStores.delete(this);
    // A run that failed midway leaves writers open; their files go with the directory.
    for (const writer of this.#writers) writer.abandon();
    this.#writers.clear();
    for (const spool of this.#spools) spool.close();
    this.#spools.clear();
    rmSync(this.directory, { recursive: true, force: true });
  }

  #file(): FactFile {
    if (this.#disposed) throw new Error("Fact store is disposed.");
    return new FactFile(join(this.directory, `${this.#next++}.jsonl`));
  }

  #track(writer: { abandon(): void }): () => void {
    this.#writers.add(writer);
    return () => this.#writers.delete(writer);
  }
}

/** Stores not disposed by their owner (a handler that was never stopped) go when the process exits. */
const liveStores = new Set<FactStore>();
let exitHookInstalled = false;

/** Disposes every fact store still open (process exit; test runners, which emit no exit event). */
export function disposeAllFactStores(): void {
  for (const store of [...liveStores]) store.dispose();
}

/**
 * `items` sorted by `key` (code-point order), in bounded memory (ADR-009 step 5): runs of at most `runLength`
 * items are sorted and written out, then merged. Equal keys keep their input order, so the list equals a stable
 * in-memory sort of all items.
 */
export function sortedFactArray<T>(store: FactStore, items: Iterable<T>, key: (item: T) => string, runLength = 100_000): FactArray<T> {
  const runs: FactArray<T>[] = [];
  let run: T[] = [];
  const flush = (): void => {
    if (run.length === 0) return;
    runs.push(toFactArray(store, sortByKey(run, key)));
    run = [];
  };
  for (const item of items) {
    run.push(item);
    if (run.length >= runLength) flush();
  }
  if (runs.length === 0) return toFactArray(store, sortByKey(run, key));
  flush();
  return toFactArray(store, mergeRuns(runs, key));
}

/** The items of sorted `runs` in one order; on equal keys an earlier run comes first. */
function* mergeRuns<T>(runs: readonly FactArray<T>[], key: (item: T) => string): Generator<T> {
  interface Head { readonly key: string; readonly run: number; readonly item: T; readonly rest: Iterator<T> }
  const heap: Head[] = [];
  const before = (left: Head, right: Head): boolean => compareCodePoints(left.key, right.key) < 0 || (left.key === right.key && left.run < right.run);
  const push = (head: Head): void => {
    heap.push(head);
    for (let child = heap.length - 1; child > 0;) {
      const parent = (child - 1) >> 1;
      if (!before(heap[child]!, heap[parent]!)) break;
      [heap[child], heap[parent]] = [heap[parent]!, heap[child]!];
      child = parent;
    }
  };
  const pop = (): Head => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      for (let parent = 0; ;) {
        const left = parent * 2 + 1;
        const right = left + 1;
        let first = parent;
        if (left < heap.length && before(heap[left]!, heap[first]!)) first = left;
        if (right < heap.length && before(heap[right]!, heap[first]!)) first = right;
        if (first === parent) break;
        [heap[first], heap[parent]] = [heap[parent]!, heap[first]!];
        parent = first;
      }
    }
    return top;
  };
  const advance = (run: number, rest: Iterator<T>): void => {
    const next = rest.next();
    if (next.done !== true) push({ key: key(next.value), run, item: next.value, rest });
  };
  runs.forEach((list, run) => advance(run, list[Symbol.iterator]()));
  while (heap.length > 0) {
    const head = pop();
    yield head.item;
    advance(head.run, head.rest);
  }
}

/** Writes `items` to a new list in `store` (or in `spool`, beside other lists). */
export function toFactArray<T>(store: FactStore | FactSpool, items: Iterable<T>): FactArray<T> {
  const writer = store.writer<T>();
  for (const item of items) writer.append(item);
  return writer.seal();
}
