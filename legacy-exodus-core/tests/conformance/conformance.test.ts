import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { rm } from "node:fs/promises";

import type { LegacyExodusEngine } from "@core/engine";
import { createLegacyExodusEngine } from "@runtime/composition/services";

// The accuracy report uses the same evaluation, so the report and this gate cannot disagree.
import { analyzeCase, holds, runtimeFlow } from "../../benchmarks/accuracy";
import { extractFacts } from "../../benchmarks/fact-diff";
import { conformanceCases } from "./cases";
import { knownGaps } from "./known-gaps";

let engine: LegacyExodusEngine;
const workspaces: string[] = [];

beforeAll(async () => {
  engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });
  await engine.initialize();
});

afterAll(async () => {
  await engine.shutdown();
  for (const workspace of workspaces) await rm(workspace, { recursive: true, force: true });
});

describe("conformance corpus", () => {
  it("has unique expectation ids and a ledger that names only real expectations", () => {
    const ids = conformanceCases.flatMap((testCase) => testCase.expectations.map((expectation) => expectation.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(knownGaps).filter((id) => !ids.includes(id))).toEqual([]);
  });

  for (const testCase of conformanceCases) {
    it(testCase.id, async () => {
      if (testCase.runtime !== undefined) {
        // The ground truth itself is checked first: a wrong expectation must never pass as a gap.
        expect(runtimeFlow(testCase.files["p.js"] ?? "")).toBe(testCase.runtime === "flow");
      }
      const { discovery, workspace } = await analyzeCase(engine, testCase);
      workspaces.push(workspace);
      const facts = extractFacts(discovery);
      const regressions: string[] = [];
      const fixed: string[] = [];
      for (const expectation of testCase.expectations) {
        const ok = holds(expectation, facts, discovery);
        const gap = knownGaps[expectation.id];
        if (!ok && gap === undefined) regressions.push(expectation.id);
        if (ok && gap !== undefined) fixed.push(`${expectation.id} (${gap}): now holds; remove it from known-gaps.ts`);
      }
      expect({ regressions, fixed }).toEqual({ regressions: [], fixed: [] });
    }, 30_000);
  }
});
