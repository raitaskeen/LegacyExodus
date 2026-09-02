import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";

import { StreamingJsonWriter } from "@storage/projections/streaming-json-writer";

describe("StreamingJsonWriter — Deterministic Streaming Serialization & Failure-First Suite", () => {
  const testDir = join(tmpdir(), "scratch-streaming-test");
  const writer = new StreamingJsonWriter();

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  // ─── 1. Basic Serialization & Byte-Exact Identity ─────────────────────────

  it("produces byte-exact output for empty object, empty array, primitives, and null", async () => {
    const cases = [
      { name: "empty-obj", payload: {} },
      { name: "empty-arr", payload: [] },
      { name: "string-prim", payload: "LegacyExodus Deterministic Stream" },
      { name: "num-prim", payload: 42 },
      { name: "bool-prim", payload: true },
      { name: "null-prim", payload: null },
    ];

    for (const { name, payload } of cases) {
      const dest = join(testDir, `${name}.json`);
      await writer.writeAtomic(dest, payload);
      const actual = await readFile(dest, "utf8");
      const expected = `${JSON.stringify(payload, null, 2)}\n`;
      expect(actual).toBe(expected);
    }
  });

  it("produces byte-exact output for deeply nested objects and arrays", async () => {
    const complexPayload = {
      projectId: "33333333-3333-4333-8333-333333333333",
      meta: {
        engine: "LegacyExodus",
        version: "0.1.0",
        nested: { count: 10, tags: ["stream", "deterministic", "byte-exact"] },
      },
      flags: [true, false, null, 123.45],
    };

    const dest = join(testDir, "complex.json");
    await writer.writeAtomic(dest, complexPayload);
    const actual = await readFile(dest, "utf8");
    const expected = `${JSON.stringify(complexPayload, null, 2)}\n`;
    expect(actual).toBe(expected);
  });

  // ─── 2. Projection-Style Artifacts ────────────────────────────────────────

  it("produces byte-exact output for top-level array artifacts (symbols/files style)", async () => {
    const symbolsPayload = Array.from({ length: 50 }, (_, i) => ({
      id: `sym-${i}`,
      name: `function_${i}`,
      filePath: `lib/module_${i % 5}.js`,
      exported: i % 2 === 0,
      defaultExport: false,
      location: { line: i * 10, column: 1 },
    }));

    const dest = join(testDir, "symbols.json");
    await writer.writeAtomic(dest, symbolsPayload);
    const actual = await readFile(dest, "utf8");
    const expected = `${JSON.stringify(symbolsPayload, null, 2)}\n`;
    expect(actual).toBe(expected);
  });

  it("produces byte-exact output for wrapped object artifacts (control-flow/data-flow style)", async () => {
    const flowPayload = {
      projectId: "00000000-0000-4000-8000-000000000001",
      analysisRunId: "11111111-1111-4111-8111-111111111111",
      graphs: Array.from({ length: 25 }, (_, i) => ({
        id: `cfg-${i}`,
        filePath: `lib/handler_${i}.js`,
        functionName: `handleRequest_${i}`,
        blocks: [
          { id: "b0", statements: ["const a = 1;", "const b = 2;"] },
          { id: "b1", statements: ["return a + b;"] },
        ],
        edges: [{ from: "b0", to: "b1", kind: "unconditional" }],
      })),
    };

    const dest = join(testDir, "control-flow.json");
    await writer.writeAtomic(dest, flowPayload);
    const actual = await readFile(dest, "utf8");
    const expected = `${JSON.stringify(flowPayload, null, 2)}\n`;
    expect(actual).toBe(expected);
  });

  it("produces byte-exact output for multi-array artifacts (semantic.json style)", async () => {
    const semanticPayload = {
      projectId: "00000000-0000-4000-8000-000000000001",
      calls: [{ id: "c1", caller: "main", callee: "init", resolution: "RESOLVED" }],
      references: [{ id: "r1", symbolId: "s1", line: 42 }],
      scopes: [{ id: "sc1", parentId: null }],
      deadCode: [],
      unusedImports: [],
      unusedExports: [],
    };

    const dest = join(testDir, "semantic.json");
    await writer.writeAtomic(dest, semanticPayload);
    const actual = await readFile(dest, "utf8");
    const expected = `${JSON.stringify(semanticPayload, null, 2)}\n`;
    expect(actual).toBe(expected);
  });

  // ─── 3. Determinism Verification ──────────────────────────────────────────

  it("guarantees 100% bit-for-bit identical bytes across repeated serialization runs", async () => {
    const payload = {
      modules: Array.from({ length: 30 }, (_, i) => ({
        path: `src/features/feature_${i}.ts`,
        exports: [`exp_${i}_a`, `exp_${i}_b`],
      })),
    };

    const dest1 = join(testDir, "run1.json");
    const dest2 = join(testDir, "run2.json");

    await writer.writeAtomic(dest1, payload);
    await writer.writeAtomic(dest2, payload);

    const buf1 = await readFile(dest1);
    const buf2 = await readFile(dest2);

    expect(buf1.equals(buf2)).toBe(true);
  });

  // ─── 4. Failure-First & Atomic Safety ─────────────────────────────────────

  it("cleans up temporary file and surfaces error if destination directory is invalid", async () => {
    const invalidDest = join(testDir, "non-existent-sub-dir", "artifact.json");

    let errorThrown = false;
    try {
      await writer.writeAtomic(invalidDest, { data: [1, 2, 3] });
    } catch {
      errorThrown = true;
    }

    expect(errorThrown).toBe(true);
    const files = await readdir(testDir);
    const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });

  it("preserves existing valid file if an error occurs during atomic stream writing", async () => {
    const finalDest = join(testDir, "existing-valid.json");
    const originalContent = '{"status":"ORIGINAL_VALID_DATA"}\n';
    await writeFile(finalDest, originalContent, "utf8");

    const faultyPayload = {
      validHeader: "test",
      get brokenProp() {
        throw new Error("Simulated serialization crash mid-stream");
      },
    };

    let errorThrown = false;
    try {
      await writer.writeAtomic(finalDest, faultyPayload);
    } catch {
      errorThrown = true;
    }

    expect(errorThrown).toBe(true);

    const intactContent = await readFile(finalDest, "utf8");
    expect(intactContent).toBe(originalContent);

    const files = await readdir(testDir);
    const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });

  it("handles concurrent writeAtomic calls to the same destination without temp file collisions or orphans", async () => {
    const dest = join(testDir, "concurrent-safety.json");

    const writes = Array.from({ length: 10 }, (_, i) =>
      writer.writeAtomic(dest, {
        writerId: i,
        records: Array.from({ length: 50 }, (_, j) => ({ id: j, label: `record_${i}_${j}` })),
      }),
    );

    const results = await Promise.allSettled(writes);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const content = await readFile(dest, "utf8");
    const parsed = JSON.parse(content);
    expect(parsed).toHaveProperty("writerId");
    expect(parsed).toHaveProperty("records");
    expect(parsed.records).toHaveLength(50);

    const files = await readdir(testDir);
    const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });

  // ─── 5. Incremental Chunking Verification ─────────────────────────────────

  it("writes array items in discrete incremental chunks rather than one giant buffer", async () => {
    const chunksWritten: string[] = [];

    const mockStream = new Writable({
      write(chunk, _encoding, callback) {
        chunksWritten.push(chunk.toString());
        callback();
      },
    });

    const smallBufferWriter = new StreamingJsonWriter(16);
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
    await smallBufferWriter.writeToStream(items, mockStream);

    expect(chunksWritten.length).toBeGreaterThanOrEqual(2);
    const completeOutput = chunksWritten.join("");
    expect(completeOutput).toBe(`${JSON.stringify(items, null, 2)}\n`);
  });

  // ─── 6. On-the-Fly SHA-256 & Byte Length Computation (P0.4) ───────────────

  it("computes exact SHA-256 and byte length on the fly matching full-file read", async () => {
    const payloads = [
      { type: "empty", data: {} },
      { type: "primitives", data: [1, "two", true, null, { nested: 123 }] },
      {
        type: "large-array",
        data: Array.from({ length: 100 }, (_, i) => ({
          id: `sym-${i}`,
          name: `func_${i}`,
          file: `src/file_${i}.ts`,
          details: { count: i * 10, unicode: "✨ LegacyExodus 🚀" },
        })),
      },
    ];

    for (const { type, data } of payloads) {
      const dest = join(testDir, `hash-test-${type}.json`);
      const result = await writer.writeAtomic(dest, data);

      const fileBytes = await readFile(dest);
      const expectedSha256 = createHash("sha256").update(fileBytes).digest("hex");
      const expectedBytes = fileBytes.length;

      expect(result.sha256).toBe(expectedSha256);
      expect(result.bytes).toBe(expectedBytes);
    }
  });
});
