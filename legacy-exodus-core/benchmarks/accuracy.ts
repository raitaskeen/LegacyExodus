/**
 * Accuracy report: how much of the canonical-semantics corpus the engine meets, by fact category.
 *
 * The corpus is the conformance suite (`tests/conformance/cases.ts`): small repositories with the facts the
 * engine must, or must not, produce. A `has` expectation is a planted fact (recall); a `lacks` expectation is
 * a negative control (precision). Taint snippets run first against request/response stubs, so their ground
 * truth is proven before the engine is judged. Expectations the engine does not meet yet are in the
 * known-gaps ledger, each owned by a finding; anything else that fails is a regression.
 *
 *   bun run benchmarks/cli.ts accuracy [--output accuracy.md]
 *
 * The conformance test uses the same evaluation (`analyzeCase`, `holds`, `runtimeFlow`), so the report and
 * the gate cannot disagree.
 */

import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";

import type { LegacyExodusEngine } from "@core/engine";

import type { ConformanceCase, Expectation } from "../tests/conformance/cases";
import { extractFacts } from "./fact-diff";

type Facts = ReturnType<typeof extractFacts>;

/** Writes the case to a fresh directory and analyses it; returns the `.discovery` path and the directory. */
export async function analyzeCase(engine: LegacyExodusEngine, testCase: ConformanceCase): Promise<{ readonly discovery: string; readonly workspace: string }> {
  const workspace = await mkdtemp(join(tmpdir(), `lx-conformance-${testCase.id}-`));
  for (const [path, content] of Object.entries(testCase.files)) {
    await mkdir(dirname(join(workspace, path)), { recursive: true });
    await writeFile(join(workspace, path), content);
  }
  const result = await engine.execute({ id: randomUUID(), type: "AnalyzeProject", createdAt: new Date(), payload: { projectId: randomUUID(), path: workspace, refresh: true } });
  if (result.type !== "AnalyzeProject") throw new Error(`Expected AnalyzeProject, got ${result.type}`);
  return { discovery: join(workspace, ".discovery"), workspace };
}

export function holds(expectation: Expectation, facts: Facts, discovery: string): boolean {
  if (expectation.check !== undefined) return expectation.check(discovery);
  const category = [...(facts.get(expectation.category ?? "") ?? [])];
  if (expectation.has !== undefined && !category.some((fact) => expectation.has!.test(fact))) return false;
  if (expectation.lacks !== undefined && category.some((fact) => expectation.lacks!.test(fact))) return false;
  return true;
}

/** Runs `p.js` with request/response stubs and reports whether tainted input reached a sink. */
export function runtimeFlow(code: string): boolean {
  const sent: unknown[] = [];
  const res = { send: (value: unknown) => sent.push(value), json: (value: unknown) => sent.push(value) };
  runInNewContext(code, { req: { body: "TAINT", query: {}, params: {} }, res, Error });
  return sent.some((value) => JSON.stringify(value)?.includes("TAINT") === true || String(value).includes("TAINT"));
}

export interface ExpectationResult {
  readonly caseId: string;
  readonly id: string;
  readonly category: string;
  readonly kind: "planted" | "control" | "check";
  readonly holds: boolean;
  /** Owning finding when the expectation is a known gap. */
  readonly gap?: string;
}

export async function evaluateCases(
  engine: LegacyExodusEngine,
  cases: readonly ConformanceCase[],
  knownGaps: Readonly<Record<string, string>>,
): Promise<readonly ExpectationResult[]> {
  const results: ExpectationResult[] = [];
  for (const testCase of cases) {
    if (testCase.runtime !== undefined && runtimeFlow(testCase.files["p.js"] ?? "") !== (testCase.runtime === "flow")) {
      throw new Error(`Ground truth of ${testCase.id} is wrong: runtime says ${testCase.runtime === "flow" ? "no flow" : "flow"}.`);
    }
    const { discovery, workspace } = await analyzeCase(engine, testCase);
    try {
      const facts = extractFacts(discovery);
      for (const expectation of testCase.expectations) {
        const kind = expectation.check !== undefined ? "check" : expectation.has !== undefined ? "planted" : "control";
        const gap = knownGaps[expectation.id];
        results.push({ caseId: testCase.id, id: expectation.id, category: expectation.category ?? "custom", kind, holds: holds(expectation, facts, discovery), ...(gap === undefined ? {} : { gap }) });
      }
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
  return results;
}

export interface CategoryAccuracy {
  readonly category: string;
  readonly planted: number;
  readonly plantedHolding: number;
  readonly controls: number;
  readonly controlsHolding: number;
  readonly checks: number;
  readonly checksHolding: number;
}

export function summarize(results: readonly ExpectationResult[]): readonly CategoryAccuracy[] {
  const byCategory = new Map<string, ExpectationResult[]>();
  for (const result of results) byCategory.set(result.category, [...(byCategory.get(result.category) ?? []), result]);
  return [...byCategory.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)).map(([category, rows]) => {
    const count = (kind: ExpectationResult["kind"], holding?: boolean) => rows.filter((row) => row.kind === kind && (holding === undefined || row.holds === holding)).length;
    return { category, planted: count("planted"), plantedHolding: count("planted", true), controls: count("control"), controlsHolding: count("control", true), checks: count("check"), checksHolding: count("check", true) };
  });
}

const percent = (part: number, whole: number): string => (whole === 0 ? "—" : `${Math.round((part / whole) * 1000) / 10}%`);

/** Markdown: a recall/precision table per category, a chart, and the open gaps with their owners. */
export function formatAccuracy(results: readonly ExpectationResult[]): string {
  const rows = summarize(results);
  const planted = rows.reduce((sum, row) => sum + row.planted, 0);
  const plantedHolding = rows.reduce((sum, row) => sum + row.plantedHolding, 0);
  const controls = rows.reduce((sum, row) => sum + row.controls, 0);
  const controlsHolding = rows.reduce((sum, row) => sum + row.controlsHolding, 0);
  const regressions = results.filter((result) => !result.holds && result.gap === undefined);
  const gaps = results.filter((result) => !result.holds && result.gap !== undefined);
  const lines = [
    "# Accuracy on the canonical-semantics corpus",
    "",
    `Planted facts found (recall): **${plantedHolding}/${planted} (${percent(plantedHolding, planted)})**. ` +
      `Negative controls held (precision): **${controlsHolding}/${controls} (${percent(controlsHolding, controls)})**. ` +
      `Known gaps: ${gaps.length}. Regressions: **${regressions.length}**.`,
    "",
    "| Category | Planted found | Recall | Controls held | Precision | Checks |",
    "|---|---|---|---|---|---|",
    ...rows.map((row) => `| ${row.category} | ${row.plantedHolding}/${row.planted} | ${percent(row.plantedHolding, row.planted)} | ${row.controlsHolding}/${row.controls} | ${percent(row.controlsHolding, row.controls)} | ${row.checksHolding}/${row.checks} |`),
    "",
    "```mermaid",
    "xychart-beta",
    "  title \"Planted facts found, by category (%)\"",
    `  x-axis [${rows.filter((row) => row.planted > 0).map((row) => `"${row.category}"`).join(", ")}]`,
    "  y-axis \"recall %\" 0 --> 100",
    `  bar [${rows.filter((row) => row.planted > 0).map((row) => Math.round((row.plantedHolding / row.planted) * 100)).join(", ")}]`,
    "```",
    "",
  ];
  if (gaps.length > 0) lines.push("## Known gaps", "", "| Expectation | Category | Owner |", "|---|---|---|", ...gaps.map((gap) => `| ${gap.id} | ${gap.category} | ${gap.gap} |`), "");
  if (regressions.length > 0) lines.push("## Regressions", "", ...regressions.map((result) => `- ${result.id} (${result.category})`), "");
  return `${lines.join("\n")}\n`;
}
