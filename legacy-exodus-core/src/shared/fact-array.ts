import { createHash, type Hash } from "node:crypto";
import { closeSync, mkdtempSync, openSync, readSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHUNK_BYTES = 1 << 20;
const STORE_PREFIX = "legacy-exodus-facts-";

/**
 * A frozen list of facts kept on disk, one JSON document per line (ADR-009 step 1). Iterating reads and parses
 * one item at a time, so a whole-repository fact list is never in memory at once. `JSON.stringify` of it
 * (SQLite storage) materializes it. Items are written by `FactArrayWriter`, in order, and never change.
 */
export class FactArray<T> implements Iterable<T> {
  readonly #path: string;
  readonly #transform: ((item: unknown) => T) | undefined;

  public constructor(path: string, public readonly length: number, public readonly sha256: string, transform?: (item: unknown) => T) {
    this.#path = path;
    this.#transform = transform;
    Object.freeze(this);
  }

  /** A view of the same items, each passed through `transform` as it is read. */
  public map<U>(transform: (item: T) => U): FactArray<U> {
    const inner = this.#transform;
    return new FactArray<U>(this.#path, this.length, this.sha256, inner === undefined ? transform as (item: unknown) => U : (item) => transform(inner(item)));
  }

  public *[Symbol.iterator](): Iterator<T> {
    const descriptor = openSync(this.#path, "r");
    const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
    const decoder = new TextDecoder();
    let pending = "";
    let read = 0;
    try {
      for (;;) {
        const bytes = readSync(descriptor, buffer, 0, CHUNK_BYTES, null);
        pending += bytes === 0 ? decoder.decode() : decoder.decode(buffer.subarray(0, bytes), { stream: true });
        let start = 0;
        for (let end = pending.indexOf("\n"); end >= 0; end = pending.indexOf("\n", start)) {
          const item: unknown = JSON.parse(pending.slice(start, end));
          start = end + 1;
          read++;
          yield this.#transform === undefined ? item as T : this.#transform(item);
        }
        pending = pending.slice(start);
        if (bytes === 0) break;
      }
    } finally {
      closeSync(descriptor);
    }
    if (pending.length > 0 || read !== this.length) throw new Error(`Fact list ${this.#path} holds ${read} items, expected ${this.length}.`);
  }

  public toJSON(): T[] {
    return [...this];
  }
}

/** Appends facts to one `FactArray`; `seal` closes the file and returns the list. */
export class FactArrayWriter<T> {
  readonly #path: string;
  readonly #descriptor: number;
  readonly #hash: Hash = createHash("sha256");
  #buffer = "";
  #length = 0;
  #sealed = false;

  public constructor(path: string, private readonly onClose: () => void = () => {}) {
    this.#path = path;
    this.#descriptor = openSync(path, "wx");
  }

  /** Closes the file without producing a list. */
  public abandon(): void {
    if (this.#sealed) return;
    this.#sealed = true;
    closeSync(this.#descriptor);
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
    closeSync(this.#descriptor);
    this.#sealed = true;
    this.onClose();
    return new FactArray<T>(this.#path, this.#length, this.#hash.digest("hex"));
  }

  #flush(): void {
    if (this.#buffer.length === 0) return;
    writeSync(this.#descriptor, this.#buffer);
    this.#buffer = "";
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

  private constructor(private readonly directory: string) {}

  public static create(): FactStore {
    const store = new FactStore(mkdtempSync(join(tmpdir(), STORE_PREFIX)));
    if (liveStores.size === 0) process.once("exit", disposeAllFactStores);
    liveStores.add(store);
    return store;
  }

  public writer<T>(): FactArrayWriter<T> {
    if (this.#disposed) throw new Error("Fact store is disposed.");
    const writer: FactArrayWriter<T> = new FactArrayWriter<T>(join(this.directory, `${this.#next++}.jsonl`), () => this.#writers.delete(writer));
    this.#writers.add(writer);
    return writer;
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    liveStores.delete(this);
    // A run that failed midway leaves writers open; their files go with the directory.
    for (const writer of this.#writers) writer.abandon();
    this.#writers.clear();
    rmSync(this.directory, { recursive: true, force: true });
  }
}

/** Stores not disposed by their owner (a handler that was never stopped) go when the process exits. */
const liveStores = new Set<FactStore>();

/** Disposes every fact store still open (process exit; test runners, which emit no exit event). */
export function disposeAllFactStores(): void {
  for (const store of [...liveStores]) store.dispose();
}

/** Writes `items` to a new list in `store`. */
export function toFactArray<T>(store: FactStore, items: Iterable<T>): FactArray<T> {
  const writer = store.writer<T>();
  for (const item of items) writer.append(item);
  return writer.seal();
}
