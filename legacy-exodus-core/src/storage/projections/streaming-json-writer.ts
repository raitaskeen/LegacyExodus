import { createHash, randomUUID, type Hash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { copyFile, rename, unlink } from "node:fs/promises";
import { finished } from "node:stream/promises";
import type { Writable } from "node:stream";

import { FactArray } from "@shared/fact-array";

const PAD_2 = "  ";
const PAD_4 = "    ";
const DEFAULT_BUFFER_THRESHOLD = 64 * 1024; // 64 KB bounded flush threshold

export interface StreamWriteResult {
  readonly sha256: string;
  readonly bytes: number;
}

/**
 * Bounded buffered stream writer that batches small chunks to avoid excessive I/O syscalls
 * and microtask Promise overhead while respecting stream backpressure.
 * Automatically computes SHA-256 hash and total byte count on the fly.
 */
class BoundedStreamBuffer {
  private buffer = "";
  private readonly hash: Hash = createHash("sha256");
  private bytes = 0;

  public constructor(
    private readonly stream: Writable,
    private readonly threshold: number = DEFAULT_BUFFER_THRESHOLD,
  ) {}

  public async write(chunk: string): Promise<void> {
    this.buffer += chunk;
    if (this.buffer.length >= this.threshold) {
      await this.flush();
    }
  }

  public async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const chunk = this.buffer;
    this.buffer = "";
    this.bytes += Buffer.byteLength(chunk, "utf8");
    this.hash.update(chunk, "utf8");
    if (!this.stream.write(chunk)) {
      await new Promise<void>((resolve, reject) => {
        const onDrain = () => {
          cleanup();
          resolve();
        };
        const onError = (err: Error) => {
          cleanup();
          reject(err);
        };
        const cleanup = () => {
          this.stream.off("drain", onDrain);
          this.stream.off("error", onError);
        };
        this.stream.once("drain", onDrain);
        this.stream.once("error", onError);
      });
    }
  }

  public finish(): StreamWriteResult {
    return {
      sha256: this.hash.digest("hex"),
      bytes: this.bytes,
    };
  }
}

/**
 * Deterministic Streaming JSON Writer
 *
 * Streams top-level arrays and objects with nested arrays in incremental chunks,
 * producing byte-for-byte identical output to `JSON.stringify(payload, null, 2) + "\n"`
 * without materializing the complete document as a single contiguous string in memory.
 */
export class StreamingJsonWriter {
  public constructor(private readonly bufferThreshold: number = DEFAULT_BUFFER_THRESHOLD) {}

  /**
   * Serializes and writes a payload incrementally to a Writable stream.
   * Returns the computed SHA-256 and byte length.
   */
  public async writeToStream(payload: unknown, stream: Writable): Promise<StreamWriteResult> {
    const writer = new BoundedStreamBuffer(stream, this.bufferThreshold);

    if (Array.isArray(payload) || payload instanceof FactArray) {
      if (payload.length === 0) {
        await writer.write("[]\n");
        await writer.flush();
        return writer.finish();
      }

      await writer.write("[\n");
      const len = payload.length;
      let i = 0;
      for (const item of payload as Iterable<unknown>) {
        const itemStr = JSON.stringify(item, null, 2).replace(/\n/g, "\n" + PAD_2);
        await writer.write("  " + itemStr + (i < len - 1 ? ",\n" : "\n"));
        i++;
      }
      await writer.write("]\n");
      await writer.flush();
      return writer.finish();
    }

    if (payload !== null && typeof payload === "object") {
      const record = payload as Record<string, unknown>;
      const keys = Object.keys(record);

      if (keys.length === 0) {
        await writer.write("{}\n");
        await writer.flush();
        return writer.finish();
      }

      await writer.write("{\n");
      const keyCount = keys.length;
      for (let i = 0; i < keyCount; i++) {
        const key = keys[i]!;
        const val = record[key];
        const isLastKey = i === keyCount - 1;
        const keyPrefix = "  " + JSON.stringify(key) + ": ";

        // A fact list on disk (ADR-009) is written as the array it stands for, one item read at a time.
        if (Array.isArray(val) || val instanceof FactArray) {
          if (val.length === 0) {
            await writer.write(keyPrefix + "[]" + (isLastKey ? "\n" : ",\n"));
          } else {
            await writer.write(keyPrefix + "[\n");
            const elemCount = val.length;
            let j = 0;
            for (const elem of val as Iterable<unknown>) {
              const elemStr = JSON.stringify(elem, null, 2).replace(/\n/g, "\n" + PAD_4);
              await writer.write("    " + elemStr + (j < elemCount - 1 ? ",\n" : "\n"));
              j++;
            }
            await writer.write("  ]" + (isLastKey ? "\n" : ",\n"));
          }
        } else {
          const valStr = JSON.stringify(val, null, 2).replace(/\n/g, "\n" + PAD_2);
          await writer.write(keyPrefix + valStr + (isLastKey ? "\n" : ",\n"));
        }
      }
      await writer.write("}\n");
      await writer.flush();
      return writer.finish();
    }

    // Primitives, strings, booleans, numbers, null
    await writer.write(`${JSON.stringify(payload, null, 2)}\n`);
    await writer.flush();
    return writer.finish();
  }

  /**
   * Atomically writes a payload to a destination path using a temporary file and streaming.
   * On failure, cleans up the temporary file and ensures the final file is not corrupted.
   * Returns the computed SHA-256 and byte length.
   */
  public async writeAtomic(destinationPath: string, payload: unknown): Promise<StreamWriteResult> {
    const temporaryPath = `${destinationPath}.${randomUUID()}.tmp`;
    const stream = createWriteStream(temporaryPath, { encoding: "utf8" });

    try {
      const result = await this.writeToStream(payload, stream);
      stream.end();
      await finished(stream);
      await this.replaceFile(temporaryPath, destinationPath);
      return result;
    } catch (error) {
      await new Promise<void>((resolve) => {
        if (stream.closed) {
          resolve();
        } else {
          stream.once("close", () => resolve());
          stream.destroy();
        }
      });
      try {
        await unlink(temporaryPath);
      } catch {
        // Ignore unlink error if temporary file was not yet created or already unlinked
      }
      throw error;
    }
  }

  /**
   * Atomically replaces targetPath with sourcePath.
   *
   * On Windows and POSIX systems with active scanners or indexing handles,
   * atomic rename can encounter transient `EBUSY`, `EPERM`, or `EACCES` locks.
   * Employs linear backoff retry before falling back to copy+unlink.
   */
  private async replaceFile(sourcePath: string, targetPath: string): Promise<void> {
    const maxRetries = 15;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await rename(sourcePath, targetPath);
        return;
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        const isTransient = code === "EBUSY" || code === "EPERM" || code === "EACCES";
        if (attempt === maxRetries - 1) {
          try {
            await copyFile(sourcePath, targetPath);
            await unlink(sourcePath);
            return;
          } catch {
            throw err;
          }
        }
        if (isTransient) {
          await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 10));
          continue;
        }
        try {
          await copyFile(sourcePath, targetPath);
          await unlink(sourcePath);
          return;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 10));
        }
      }
    }
  }
}
