/**
 * Flow oracle (Phase A4): runs a pinned corpus's own tests under Node's built-in coverage (NODE_V8_COVERAGE, no
 * instrumentation, so positions are the original ones) and checks two engine claims against what really ran:
 *
 * - a statement in a block the CFG marks unreachable, or a node it marks dead, must never execute;
 * - a function the engine reports as dead code must never run.
 *
 * Either one executing is a contradiction: a false fact. Also reported: how many CFG statements the tests executed.
 * Like the call oracle, this runs only pinned public corpora, in a temporary copy.
 */
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeCleanCopy, installAndTest, offsetOf } from "./call-oracle";

/** The test command per corpus when its npm script collects coverage itself. */
const COVERAGE_COMMANDS: Readonly<Record<string, readonly string[]>> = { fastify: ["npx", "borp", "--reporter=@jsumners/line-reporter"] };

interface Range { readonly start: number; readonly end: number; readonly count: number }

export interface FlowOracleResult {
  readonly corpus: string;
  readonly testExit: number | null;
  readonly statements: number;
  readonly executedStatements: number;
  readonly unreachableClaims: number;
  readonly deadCodeFindings: number;
  readonly contradictions: readonly string[];
}

/**
 * Whether the code at \`offset\` ran: the innermost coverage range around it has a count above zero. V8 nests block
 * ranges inside function ranges, so the innermost one is the most specific. A file never loaded has no ranges.
 */
export function executedAt(ranges: readonly Range[] | undefined, offset: number): boolean {
  let best: Range | undefined;
  for (const range of ranges ?? []) {
    if (range.start <= offset && offset < range.end && (best === undefined || range.end - range.start <= best.end - best.start)) best = range;
  }
  return best !== undefined && best.count > 0;
}

/** Coverage ranges per corpus-relative file, merged over every process the test run started. */
export function readCoverage(directory: string, root: string): Map<string, Range[]> {
  const byFile = new Map<string, Range[]>();
  for (const entry of readdirSync(directory).sort()) {
    if (!entry.endsWith(".json")) continue;
    const report = JSON.parse(readFileSync(join(directory, entry), "utf8"));
    for (const script of report.result ?? []) {
      if (typeof script.url !== "string" || !script.url.startsWith("file:")) continue;
      const file = relative(root, fileURLToPath(script.url)).split(sep).join("/");
      if (file.startsWith("..") || file.includes("node_modules/")) continue;
      const ranges = byFile.get(file) ?? [];
      for (const fn of script.functions ?? []) for (const range of fn.ranges ?? []) ranges.push({ start: range.startOffset, end: range.endOffset, count: range.count });
      byFile.set(file, ranges);
    }
  }
  return byFile;
}

/** Runs the flow oracle on one corpus directory with the engine at \`engineRoot\`. */
export function runFlowOracle(engineRoot: string, corpus: string): FlowOracleResult {
  const work = mkdtempSync(join(tmpdir(), "lx-flow-oracle-"));
  try {
    const { name, script, clean } = analyzeCleanCopy(engineRoot, corpus, work);
    const read = (artifact: string) => JSON.parse(readFileSync(join(clean, ".discovery", artifact), "utf8"));
    const controlFlow = read("control-flow.json");
    const semantic = read("semantic.json");
    const symbols: any[] = read("symbols.json");

    const run = join(work, "run", name);
    cpSync(clean, run, { recursive: true, filter: (path) => !/[\\/]\.discovery([\\/]|$)/.test(path) });
    const coverageDirectory = join(work, "coverage");
    mkdirSync(coverageDirectory);
    // A runner that collects coverage itself (Fastify's `borp --coverage`) redirects NODE_V8_COVERAGE: run it without.
    const testExit = installAndTest(run, script, { NODE_V8_COVERAGE: coverageDirectory }, COVERAGE_COMMANDS[name]);
    const coverage = readCoverage(coverageDirectory, run);

    // Offsets come from the clean copy: the run copy has the same sources.
    const ran = (file: string, line: number, column: number): boolean => executedAt(coverage.get(file), offsetOf(join(clean, file), line, column));
    const contradictions: string[] = [];
    let statements = 0;
    let executedStatements = 0;
    let unreachableClaims = 0;
    for (const graph of controlFlow.graphs ?? []) {
      const unreachable = new Set<string>(graph.unreachableBlockIds ?? []);
      const dead = new Set<string>(graph.deadCodeNodeIds ?? []);
      for (const block of graph.blocks ?? []) {
        for (const statement of block.statements ?? []) {
          if (statement.location === undefined) continue;
          statements++;
          const claimed = unreachable.has(block.id) || dead.has(statement.id);
          if (claimed) unreachableClaims++;
          if (!ran(graph.filePath, statement.location.line, statement.location.column)) continue;
          executedStatements++;
          if (claimed) contradictions.push(`${graph.filePath}:${statement.location.line}:${statement.location.column} ${statement.type} in ${graph.scopeName} is marked unreachable but ran`);
        }
      }
    }

    // A dead-code finding is contradicted when any CFG statement inside the function ran: a nested statement only
    // runs once the function itself has been called.
    const symbolById = new Map(symbols.map((symbol) => [symbol.id, symbol]));
    const statementsByFile = new Map<string, { readonly line: number; readonly column: number }[]>();
    for (const graph of controlFlow.graphs ?? []) {
      const list = statementsByFile.get(graph.filePath) ?? [];
      for (const block of graph.blocks ?? []) for (const statement of block.statements ?? []) if (statement.location !== undefined) list.push(statement.location);
      statementsByFile.set(graph.filePath, list);
    }
    const findings: any[] = semantic.deadCode ?? [];
    for (const finding of findings) {
      const symbol = symbolById.get(finding.symbolId);
      const location = symbol?.location;
      // Only a callable can be shown alive by running: an unused variable's declaration runs and it stays unused.
      if (location === undefined || !["function", "method", "class"].includes(symbol.kind)) continue;
      const inside = (point: { readonly line: number; readonly column: number }): boolean =>
        (point.line > location.start.line || (point.line === location.start.line && point.column >= location.start.column))
        && (point.line < location.end.line || (point.line === location.end.line && point.column <= location.end.column));
      const executed = (statementsByFile.get(symbol.filePath) ?? []).some((point) => inside(point) && ran(symbol.filePath, point.line, point.column));
      if (executed) contradictions.push(`${symbol.filePath}:${location.start.line}:${location.start.column} ${symbol.kind} ${symbol.name} is reported as dead code (${finding.reason}) but ran`);
    }
    return { corpus: name, testExit, statements, executedStatements, unreachableClaims, deadCodeFindings: findings.filter((finding) => ["function", "method", "class"].includes(symbolById.get(finding.symbolId)?.kind)).length, contradictions: contradictions.sort() };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Markdown summary of one flow oracle run. */
export function formatFlowOracle(result: FlowOracleResult): string {
  const lines = [
    `## Flow oracle: ${result.corpus}`,
    "",
    `Test run exit code ${result.testExit}.`,
    "",
    "| Measure | Value |",
    "|---|---|",
    `| CFG statements | ${result.statements} |`,
    `| ... executed by the tests | ${result.executedStatements} (${result.statements === 0 ? "n/a" : `${((100 * result.executedStatements) / result.statements).toFixed(1)}%`}) |`,
    `| Statements the CFG marks unreachable or dead | ${result.unreachableClaims} |`,
    `| Dead-code findings (callables checked against the run) | ${result.deadCodeFindings} |`,
    `| **Contradictions (claimed unreachable or dead, but ran)** | ${result.contradictions.length} |`,
    "",
  ];
  if (result.contradictions.length > 0) lines.push("Contradictions:", "", ...result.contradictions.slice(0, 50).map((line) => `- \`${line}\``), "");
  return lines.join("\n");
}

