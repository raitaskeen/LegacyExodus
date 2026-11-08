import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";

import type { LegacyExodusEngine } from "@core/engine";
import { createLegacyExodusEngine } from "@runtime/composition/services";

import { extractFacts } from "../../benchmarks/fact-diff";
import { conformanceCases, type ConformanceCase, type Expectation } from "./cases";
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

async function analyze(testCase: ConformanceCase): Promise<string> {
  const projectPath = await mkdtemp(join(tmpdir(), `lx-conformance-${testCase.id}-`));
  workspaces.push(projectPath);
  for (const [path, content] of Object.entries(testCase.files)) {
    await mkdir(dirname(join(projectPath, path)), { recursive: true });
    await writeFile(join(projectPath, path), content);
  }
  const result = await engine.execute({ id: randomUUID(), type: "AnalyzeProject", createdAt: new Date(), payload: { projectId: randomUUID(), path: projectPath, refresh: true } });
  if (result.type !== "AnalyzeProject") throw new Error(`Expected AnalyzeProject, got ${result.type}`);
  return join(projectPath, ".discovery");
}

function holds(expectation: Expectation, facts: ReturnType<typeof extractFacts>, discovery: string): boolean {
  if (expectation.check !== undefined) return expectation.check(discovery);
  const category = [...(facts.get(expectation.category ?? "") ?? [])];
  if (expectation.has !== undefined && !category.some((fact) => expectation.has!.test(fact))) return false;
  if (expectation.lacks !== undefined && category.some((fact) => expectation.lacks!.test(fact))) return false;
  return true;
}

/** Runs `p.js` with request/response stubs and reports whether tainted input reached a sink. */
function runtimeFlow(code: string): boolean {
  const sent: unknown[] = [];
  const res = { send: (value: unknown) => sent.push(value), json: (value: unknown) => sent.push(value) };
  runInNewContext(code, { req: { body: "TAINT", query: {}, params: {} }, res, Error });
  return sent.some((value) => JSON.stringify(value)?.includes("TAINT") === true || String(value).includes("TAINT"));
}

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
      const discovery = await analyze(testCase);
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
