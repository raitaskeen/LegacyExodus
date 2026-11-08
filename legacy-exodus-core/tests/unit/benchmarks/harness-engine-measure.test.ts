import { afterEach, describe, expect, it } from "bun:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executeBenchmarkRun } from "../../../benchmarks/harness";

/**
 * NA-04: the scale gate measures the engine. The harness records the engine's own wall time and the
 * process's peak memory when the engine returned (before it re-reads the projected JSON), and whether a
 * stored snapshot was reused, so a scale run can refuse to measure a reuse as an analysis.
 */

let directory: string | undefined;
afterEach(() => {
  if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("NA-04 benchmark harness measures the engine", () => {
  it("reports engine time and peak memory, and tells a fresh analysis from a snapshot reuse", async () => {
    directory = mkdtempSync(join(tmpdir(), "lx-harness-"));
    const corpus = join(directory, "corpus");
    cpSync(join(import.meta.dir, "../../../benchmarks/fixtures/governance-audit"), corpus, { recursive: true });

    const fresh = await executeBenchmarkRun(corpus, 0);
    expect(fresh.snapshotReused).toBe(false);
    expect(fresh.engineWallMs).toBeGreaterThan(0);
    expect(fresh.engineMaxRssMb).toBeGreaterThan(0);

    const reused = await executeBenchmarkRun(corpus, 1);
    expect(reused.snapshotReused).toBe(true);
  });
});
