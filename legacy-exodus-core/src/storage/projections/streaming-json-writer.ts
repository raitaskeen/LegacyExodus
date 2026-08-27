import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { copyFile, rename, unlink } from "node:fs/promises";
import { finished } from "node:stream/promises";
import type { Writable } from "node:stream";

const PAD_2 = "  ";
const PAD_4 = "    ";
const DEFAULT_BUFFER_THRESHOLD = 64 * 1024; // 64 KB bounded flush threshold

/**
 * Bounded buffered stream writer that batches small chunks to avoid excessive I/O syscalls
 * and microtask Promise overhead while respecting stream backpressure.
 */
class BoundedStreamBuffer {
  private buffer = "";

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
   */
  public async writeToStream(payload: unknown, stream: Writable): Promise<void> {
    const writer = new BoundedStreamBuffer(stream, this.bufferThreshold);

    if (Array.isArray(payload)) {
      if (payload.length === 0) {
        await writer.write("[]\n");
        await writer.flush();
        return;
      }

      await writer.write("[\n");
      const len = payload.length;
      for (let i = 0; i < len; i++) {
        const itemStr = JSON.stringify(payload[i], null, 2).replace(/\n/g, "\n" + PAD_2);
        await writer.write("  " + itemStr + (i < len - 1 ? ",\n" : "\n"));
      }
      await writer.write("]\n");
      await writer.flush();
      return;
    }

    if (payload !== null && typeof payload === "object") {
      const record = payload as Record<string, unknown>;
      const keys = Object.keys(record);

      if (keys.length === 0) {
        await writer.write("{}\n");
        await writer.flush();
        return;
      }

      await writer.write("{\n");
      const keyCount = keys.length;
      for (let i = 0; i < keyCount; i++) {
        const key = keys[i]!;
        const val = record[key];
        const isLastKey = i === keyCount - 1;
        const keyPrefix = "  " + JSON.stringify(key) + ": ";

        if (Array.isArray(val)) {
          if (val.length === 0) {
            await writer.write(keyPrefix + "[]" + (isLastKey ? "\n" : ",\n"));
          } else {
            await writer.write(keyPrefix + "[\n");
            const elemCount = val.length;
            for (let j = 0; j < elemCount; j++) {
              const elemStr = JSON.stringify(val[j], null, 2).replace(/\n/g, "\n" + PAD_4);
              await writer.write("    " + elemStr + (j < elemCount - 1 ? ",\n" : "\n"));
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
      return;
    }

    // Primitives, strings, booleans, numbers, null
    await writer.write(`${JSON.stringify(payload, null, 2)}\n`);
    await writer.flush();
  }

  /**
   * Atomically writes a payload to a destination path using a temporary file and streaming.
   * On failure, cleans up the temporary file and ensures the final file is not corrupted.
   */
  public async writeAtomic(destinationPath: string, payload: unknown): Promise<void> {
    const temporaryPath = `${destinationPath}.${randomUUID()}.tmp`;
    const stream = createWriteStream(temporaryPath, { encoding: "utf8" });

    try {
      await this.writeToStream(payload, stream);
      stream.end();
      await finished(stream);
      try {
        await rename(temporaryPath, destinationPath);
      } catch {
        await copyFile(temporaryPath, destinationPath);
        await unlink(temporaryPath);
      }
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
}
