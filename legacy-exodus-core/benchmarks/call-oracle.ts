/**
 * Call oracle (Phase A3): runs a corpus's own test suite with every function instrumented to record which call site
 * entered it, then checks the engine's calls against what really happened.
 *
 * - Precision: a RESOLVED call whose observed callee is a different function is a contradiction, a false fact.
 * - Recall: of the call sites the tests exercised into a repository function, how many the engine resolved to it.
 * - The observed sites the engine left UNRESOLVED, by reason: where coverage work pays.
 *
 * This executes the corpus's code, which the engine itself never does. It runs only on the pinned public corpora,
 * in a temporary copy, never on a user's repository.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, posix, relative, resolve, sep } from "node:path";
import { parse } from "@babel/parser";

/** The test command per pinned corpus: an npm script name. */
const TEST_SCRIPTS: Readonly<Record<string, string>> = { express: "test", fastify: "unit" };

interface Insertion { readonly line: number; readonly column: number; readonly length: number }
/** `callee`: how the engine's callee name must end for this site (several calls can start at one position: `f().g()`). */
interface CallSite { readonly file: string; readonly start: { line: number; column: number }; readonly from: number; readonly to: number; readonly line: number; readonly callee: string | undefined }

export interface OracleResult {
  readonly corpus: string;
  readonly testExit: number | null;
  readonly observedSites: number;
  readonly matchedSites: number;
  readonly resolvedAgree: number;
  readonly contradictions: readonly string[];
  /** Contradictions explained by a test replacing the module at load time (`proxyquire`): outside Node's own loading. */
  readonly substitutions: readonly string[];
  readonly unverifiable: number;
  readonly unresolvedByReason: ReadonlyMap<string, number>;
  readonly instrumentedFiles: number;
  readonly skippedFiles: readonly string[];
}

/** Every source file of the corpus that the instrumenter and the engine both see. */
function sourceFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory).sort()) {
      if (entry === "node_modules" || entry === ".git" || entry === ".discovery") continue;
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(c|m)?js$/.test(entry)) files.push(path);
    }
  };
  walk(root);
  return files;
}

function parseFile(source: string): any {
  return parse(source, { sourceType: "unambiguous", allowReturnOutsideFunction: true, errorRecovery: false, plugins: ["jsx"] });
}

/** Depth-first walk of a Babel AST, children in source order. */
function walk(node: any, visit: (node: any) => void): void {
  if (node === null || typeof node !== "object") return;
  if (typeof node.type === "string") visit(node);
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "leadingComments" || key === "trailingComments" || key === "innerComments" || key === "extra") continue;
    const value = node[key];
    if (Array.isArray(value)) for (const child of value) walk(child, visit);
    else if (value !== null && typeof value === "object" && typeof value.type === "string") walk(value, visit);
  }
}

const FUNCTION_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ObjectMethod", "ClassMethod", "ClassPrivateMethod"]);

/**
 * Adds `__lxEnter(file, line, column)` at the start of every function body (after its directives), or wraps an arrow's
 * expression body. Probe text has no newline, so only columns after a probe on its own line shift; the insertions are
 * returned to map positions back.
 */
export function instrument(source: string, fileIndex: number): { readonly code: string; readonly insertions: readonly Insertion[] } {
  const ast = parseFile(source);
  const edits: { readonly offset: number; readonly text: string; readonly line: number; readonly column: number }[] = [];
  walk(ast.program, (node) => {
    if (!FUNCTION_TYPES.has(node.type) || node.body === undefined || node.body === null) return;
    const probe = `__lxEnter(${fileIndex},${node.loc.start.line},${node.loc.start.column})`;
    if (node.body.type === "BlockStatement") {
      const directives: any[] = node.body.directives ?? [];
      const after = directives.length > 0 ? directives[directives.length - 1] : undefined;
      const offset = after === undefined ? node.body.start + 1 : after.end;
      const loc = after === undefined ? { line: node.body.loc.start.line, column: node.body.loc.start.column + 1 } : after.loc.end;
      edits.push({ offset, text: `${probe};`, line: loc.line, column: loc.column });
    } else {
      edits.push({ offset: node.body.start, text: `(${probe},`, line: node.body.loc.start.line, column: node.body.loc.start.column });
      edits.push({ offset: node.body.end, text: ")", line: node.body.loc.end.line, column: node.body.loc.end.column });
    }
  });
  edits.sort((left, right) => left.offset - right.offset);
  let code = "";
  let cursor = 0;
  for (const edit of edits) {
    code += source.slice(cursor, edit.offset) + edit.text;
    cursor = edit.offset;
  }
  code += source.slice(cursor);
  return { code, insertions: edits.map((edit) => ({ line: edit.line, column: edit.column, length: edit.text.length })) };
}

/** The preload that records, per call site in the corpus, which instrumented functions it entered. */
export function preloadSource(root: string, files: readonly string[], traceDirectory: string): string {
  return `"use strict";
const fs = require("fs"); const path = require("path");
const root = ${JSON.stringify(root)}; const files = ${JSON.stringify(files)};
const index = new Map(files.map((file, i) => [path.join(root, file), i]));
const seen = new Map();
const frames = (_, stack) => stack;
globalThis.__lxEnter = function __lxEnter(file, line, column) {
  const holder = {}; const prepare = Error.prepareStackTrace; const limit = Error.stackTraceLimit;
  Error.prepareStackTrace = frames; Error.stackTraceLimit = 2;
  Error.captureStackTrace(holder, __lxEnter);
  const stack = holder.stack; Error.prepareStackTrace = prepare; Error.stackTraceLimit = limit;
  const caller = Array.isArray(stack) ? stack[1] : undefined;
  if (caller === undefined) return;
  const callerFile = index.get(caller.getFileName() || "");
  if (callerFile === undefined) return;
  const key = callerFile + ":" + caller.getLineNumber() + ":" + caller.getColumnNumber();
  let callees = seen.get(key); if (callees === undefined) { callees = new Set(); seen.set(key, callees); }
  callees.add(file + ":" + line + ":" + column);
};
process.on("exit", () => {
  const out = {}; for (const [key, callees] of seen) out[key] = [...callees].sort();
  fs.writeFileSync(path.join(${JSON.stringify(traceDirectory)}, "trace-" + process.pid + ".json"), JSON.stringify(out));
});
`;
}

/** Maps an instrumented 0-based column back to the original one on that line. */
export function originalColumn(insertions: readonly Insertion[] | undefined, line: number, column: number): number {
  let shift = 0;
  for (const insertion of insertions ?? []) {
    if (insertion.line !== line) continue;
    if (insertion.column + shift <= column - insertion.length) shift += insertion.length;
  }
  return column - shift;
}

/** Call and new expressions of one original file, with the span a V8 caller position falls in. */
function callSites(file: string, source: string): CallSite[] {
  const sites: CallSite[] = [];
  walk(parseFile(source).program, (node) => {
    if (node.type !== "CallExpression" && node.type !== "OptionalCallExpression" && node.type !== "NewExpression") return;
    // V8 reports a call at its callee's name, a member call at its last property, `new` at the keyword and a computed
    // call at the parenthesis: all between the expression's start and just past the callee.
    const callee = node.callee;
    const name = callee.type === "Identifier" ? callee.name
      : (callee.type === "MemberExpression" || callee.type === "OptionalMemberExpression") && !callee.computed && callee.property.type === "Identifier" ? `.${callee.property.name}`
      : undefined;
    sites.push({ file, start: node.loc.start, from: node.start, to: node.callee.end + 1, line: node.loc.start.line, callee: name });
  });
  return sites;
}

/**
 * A clean copy of a pinned corpus (no `.git`, `.discovery` or dependencies) analysed by the engine at `engineRoot`,
 * inside `work`. Shared by the call and flow oracles.
 */
export function analyzeCleanCopy(engineRoot: string, corpus: string, work: string): { readonly name: string; readonly script: string; readonly clean: string } {
  const name = basename(resolve(corpus));
  const script = TEST_SCRIPTS[name];
  if (script === undefined) throw new Error(`No test script is configured for corpus ${name}.`);
  const clean = join(work, "clean", name);
  cpSync(resolve(corpus), clean, { recursive: true, filter: (path) => !/[\\/](\.discovery|\.git|node_modules)([\\/]|$)/.test(path) });
  const analyzed = spawnSync(process.execPath, ["run", join(engineRoot, "src/cli/index.ts"), "analyze", clean, "--refresh", "--json"], {
    cwd: engineRoot, encoding: "utf8", maxBuffer: 1 << 26, env: { ...process.env, LEGACY_EXODUS_HOME: join(work, "home"), NO_COLOR: "1" },
  });
  if (analyzed.status !== 0) throw new Error(`analyze failed: ${String(analyzed.stderr).slice(0, 2000)}`);
  return { name, script, clean };
}

/** Installs a corpus copy's dev dependencies and runs its test script with `env` added; returns the exit code. */
export function installAndTest(run: string, script: string, env: Readonly<Record<string, string>>, command: readonly string[] = ["npm", "run", script]): number | null {
  // A pinned lockfile (benchmarks/oracle-locks/<corpus>) makes the install exact and repeatable; without one npm
  // resolves the dev dependencies afresh, which can fail when the registry is mid-publish.
  const lock = join(import.meta.dir, "oracle-locks", basename(run), "package-lock.json");
  if (existsSync(lock)) cpSync(lock, join(run, "package-lock.json"));
  const install = spawnSync("npm", [existsSync(lock) ? "ci" : "install", "--no-audit", "--no-fund", "--ignore-scripts", "--loglevel=error"], { cwd: run, encoding: "utf8", shell: true, maxBuffer: 1 << 26 });
  if (install.status !== 0) throw new Error(`npm install failed: ${String(install.stderr).slice(0, 2000)}`);
  const tests = spawnSync(command[0]!, command.slice(1), { cwd: run, encoding: "utf8", shell: true, maxBuffer: 1 << 28, env: { ...process.env, NO_COLOR: "1", CI: "1", ...env } });
  return tests.status;
}

/** Runs the oracle on one corpus directory with the engine at `engineRoot`. */
export function runCallOracle(engineRoot: string, corpus: string): OracleResult {
  const work = mkdtempSync(join(tmpdir(), "lx-call-oracle-"));
  try {
    // 1. The engine's facts, from a clean copy (no dependencies installed, as in the fact diff).
    const { name, script, clean } = analyzeCleanCopy(engineRoot, corpus, work);
    const semantic = JSON.parse(readFileSync(join(clean, ".discovery", "semantic.json"), "utf8"));
    const symbols: any[] = JSON.parse(readFileSync(join(clean, ".discovery", "symbols.json"), "utf8"));

    // 2. An instrumented copy with its dev dependencies, then its own tests.
    const run = join(work, "run", name);
    cpSync(clean, run, { recursive: true, filter: (path) => !/[\\/]\.discovery([\\/]|$)/.test(path) });
    const files = sourceFiles(run).map((path) => relative(run, path).split(sep).join("/"));
    const insertions = new Map<string, readonly Insertion[]>();
    const skippedFiles: string[] = [];
    for (const [fileIndex, file] of files.entries()) {
      const path = join(run, file);
      try {
        const result = instrument(readFileSync(path, "utf8"), fileIndex);
        writeFileSync(path, result.code);
        insertions.set(file, result.insertions);
      } catch {
        skippedFiles.push(file);
      }
    }
    const traces = join(work, "traces");
    mkdirSync(traces);
    const preload = join(work, "lx-preload.cjs");
    writeFileSync(preload, preloadSource(run, files, traces));
    const testExit = installAndTest(run, script, { NODE_OPTIONS: `--require=${preload}` });

    // 3. Observed call site -> functions entered, in original coordinates.
    const observed = new Map<string, Set<string>>();
    for (const entry of readdirSync(traces).sort()) {
      const trace: Record<string, string[]> = JSON.parse(readFileSync(join(traces, entry), "utf8"));
      for (const [key, callees] of Object.entries(trace)) {
        const [fileIndex, line, column] = key.split(":").map(Number) as [number, number, number];
        const file = files[fileIndex]!;
        const original = `${file}:${line}:${originalColumn(insertions.get(file), line, column - 1)}`;
        const set = observed.get(original) ?? new Set<string>();
        for (const callee of callees) {
          const [calleeIndex, calleeLine, calleeColumn] = callee.split(":").map(Number) as [number, number, number];
          set.add(`${files[calleeIndex]}:${calleeLine}:${calleeColumn}`);
        }
        observed.set(original, set);
      }
    }

    // 4. Each observed position -> the innermost call expression covering it -> the engine's call there.
    const sitesByFile = new Map<string, CallSite[]>();
    const siteFor = (file: string, line: number, column: number): CallSite | undefined => {
      let sites = sitesByFile.get(file);
      if (sites === undefined) {
        try { sites = callSites(file, readFileSync(join(clean, file), "utf8")); } catch { sites = []; }
        sitesByFile.set(file, sites);
      }
      const offset = offsetOf(join(clean, file), line, column);
      let best: CallSite | undefined;
      for (const site of sites) if (site.from <= offset && offset <= site.to && (best === undefined || site.to - site.from < best.to - best.from)) best = site;
      return best;
    };
    const engineCalls = new Map<string, any[]>();
    for (const call of semantic.calls ?? []) {
      if (call.location === undefined) continue;
      const key = `${call.sourceFilePath}:${call.location.line}:${call.location.column}`;
      engineCalls.set(key, [...(engineCalls.get(key) ?? []), call]);
    }
    // The engine's call at a site: the only one starting there, or the one whose callee name fits the site's callee.
    const engineCallAt = (site: CallSite): any => {
      const candidates = engineCalls.get(`${site.file}:${site.start.line}:${site.start.column}`) ?? [];
      if (candidates.length <= 1) return candidates[0];
      const fitting = site.callee === undefined ? [] : candidates.filter((call) =>
        site.callee!.startsWith(".") ? String(call.calleeName).endsWith(site.callee!) : call.calleeName === site.callee || String(call.calleeName).endsWith(`.${site.callee}`));
      return fitting.length === 1 ? fitting[0] : undefined;
    };
    const symbolById = new Map(symbols.map((symbol) => [symbol.id, symbol]));
    const localByName = new Map<string, any[]>();
    for (const symbol of symbols) {
      if (symbol.kind === "export" || symbol.kind === "import") continue;
      const key = `${symbol.filePath}\u0000${symbol.name}`;
      localByName.set(key, [...(localByName.get(key) ?? []), symbol]);
    }
    // An export names a local declaration (`module.exports = createApplication`): check against that declaration.
    // A re-export (`module.exports = require('./lib/express')`) names the same export of another file.
    const exportsByFile = new Map<string, any[]>();
    for (const symbol of symbols) if (symbol.kind === "export") exportsByFile.set(symbol.filePath, [...(exportsByFile.get(symbol.filePath) ?? []), symbol]);
    const importsByFile = new Map<string, any[]>();
    for (const symbol of symbols) if (symbol.kind === "import") importsByFile.set(symbol.filePath, [...(importsByFile.get(symbol.filePath) ?? []), symbol]);
    const reexported = (symbol: any): any => {
      const specifier: string = symbol.moduleSpecifier;
      if (!specifier.startsWith(".")) return undefined;
      const base = posix.normalize(posix.join(posix.dirname(symbol.filePath), specifier));
      for (const candidate of [base, `${base}.js`, `${base}/index.js`]) {
        const match = (exportsByFile.get(candidate) ?? []).filter((other) => other.name === (symbol.sourceSymbolName ?? symbol.name) || (symbol.defaultExport === true && other.defaultExport === true));
        if (match.length === 1) return match[0];
      }
      return undefined;
    };
    const follow = (symbol: any, depth = 0): any => {
      if (symbol?.kind !== "export" || depth > 5) return symbol;
      if (typeof symbol.moduleSpecifier === "string") { const next = reexported(symbol); return next === undefined ? symbol : follow(next, depth + 1); }
      if (typeof symbol.sourceSymbolName !== "string") {
        // `module.exports = require('./x')`: the export has no name of its own, the `require` at the same place does.
        const start = symbol.location?.start;
        const required = (importsByFile.get(symbol.filePath) ?? []).filter((other) =>
          typeof other.moduleSpecifier === "string" && other.location?.start.line === start?.line && other.location?.start.column === start?.column);
        if (required.length !== 1) return symbol;
        const next = reexported({ ...symbol, moduleSpecifier: required[0].moduleSpecifier });
        return next === undefined ? symbol : follow(next, depth + 1);
      }
      const local = localByName.get(`${symbol.filePath}\u0000${symbol.sourceSymbolName}`) ?? [];
      return local.length === 1 ? follow(local[0], depth + 1) : symbol;
    };
    const contains = (symbol: any, file: string, line: number, column: number): boolean => {
      const location = symbol?.location;
      if (symbol === undefined || location === undefined || symbol.filePath !== file) return false;
      const after = line > location.start.line || (line === location.start.line && column >= location.start.column);
      const before = line < location.end.line || (line === location.end.line && column <= location.end.column);
      return after && before;
    };

    let matchedSites = 0;
    let resolvedAgree = 0;
    let unverifiable = 0;
    const contradictions: string[] = [];
    const substitutions: string[] = [];
    const substitutes = new Map<string, boolean>();
    const usesProxyquire = (calleeFile: string): boolean => {
      let uses = substitutes.get(calleeFile);
      if (uses === undefined) {
        try { uses = readFileSync(join(clean, calleeFile), "utf8").includes("proxyquire("); } catch { uses = false; }
        substitutes.set(calleeFile, uses);
      }
      return uses;
    };
    const unresolvedByReason = new Map<string, number>();
    for (const [position, callees] of [...observed].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))) {
      const [file, line, column] = splitPosition(position);
      const site = siteFor(file, line, column);
      const call = site === undefined ? undefined : engineCallAt(site);
      if (call === undefined) continue;
      matchedSites++;
      if (call.resolutionState !== "RESOLVED") {
        const reason = call.reason ?? "not-recorded";
        unresolvedByReason.set(reason, (unresolvedByReason.get(reason) ?? 0) + 1);
        continue;
      }
      const target = follow(symbolById.get(call.targetSymbolId));
      const precise = target !== undefined && (target.kind === "function" || target.kind === "method");
      const agrees = [...callees].every((callee) => { const [f, l, c] = splitPosition(callee); return contains(target, f, l, c); });
      if (agrees) resolvedAgree++;
      else if (precise) {
        const line = `${file}:${site!.start.line}:${site!.start.column} ${call.calleeName} -> engine ${target.name}@${target.filePath}:${target.location?.start.line}, observed ${[...callees].join(", ")}`;
        const others = [...callees].filter((callee) => { const [f, l, c] = splitPosition(callee); return !contains(target, f, l, c); });
        if (others.every((callee) => usesProxyquire(splitPosition(callee)[0]))) substitutions.push(line);
        else contradictions.push(line);
      }
      else {
        unverifiable++;
        if (process.env.LX_ORACLE_DEBUG !== undefined && unverifiable <= 25) console.error("UNVERIFIABLE", file, site!.start.line, call.calleeName, target?.kind, target?.name, JSON.stringify(target?.location), [...callees].join(" "));
      }
    }
    return { corpus: name, testExit, observedSites: observed.size, matchedSites, resolvedAgree, contradictions, substitutions, unverifiable, unresolvedByReason, instrumentedFiles: insertions.size, skippedFiles };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function splitPosition(position: string): [string, number, number] {
  const parts = position.split(":");
  const column = Number(parts.pop());
  const line = Number(parts.pop());
  return [parts.join(":"), line, column];
}

const lineStarts = new Map<string, number[]>();
/** The character offset of a 1-based line and 0-based column in the file at `path`. */
export function offsetOf(path: string, line: number, column: number): number {
  let starts = lineStarts.get(path);
  if (starts === undefined) {
    const source = existsSync(path) ? readFileSync(path, "utf8") : "";
    starts = [0];
    for (let index = 0; index < source.length; index++) if (source[index] === "\n") starts.push(index + 1);
    lineStarts.set(path, starts);
  }
  return (starts[line - 1] ?? 0) + column;
}

/** Markdown summary of one oracle run. */
export function formatOracle(result: OracleResult): string {
  const precisionBase = result.resolvedAgree + result.contradictions.length;
  const lines = [
    `## Call oracle: ${result.corpus}`,
    "",
    `Test run exit code ${result.testExit}. Instrumented ${result.instrumentedFiles} files${result.skippedFiles.length > 0 ? ` (${result.skippedFiles.length} not parsed: ${result.skippedFiles.slice(0, 5).join(", ")})` : ""}.`,
    "",
    "| Measure | Value |",
    "|---|---|",
    `| Call sites the tests exercised into repository functions | ${result.observedSites} |`,
    `| ... matched to an engine call | ${result.matchedSites} |`,
    `| RESOLVED, observed callee agrees | ${result.resolvedAgree} |`,
    `| RESOLVED, observed callee contradicts (false facts) | ${result.contradictions.length} |`,
    `| RESOLVED, contradicted only by a test's module substitution (proxyquire) | ${result.substitutions.length} |`,
    `| RESOLVED, not checkable (target is not a function or method symbol) | ${result.unverifiable} |`,
    `| Precision | ${precisionBase === 0 ? "n/a" : `${((100 * result.resolvedAgree) / precisionBase).toFixed(1)}%`} |`,
    `| Recall (agreeing / matched) | ${result.matchedSites === 0 ? "n/a" : `${((100 * result.resolvedAgree) / result.matchedSites).toFixed(1)}%`} |`,
    "",
  ];
  const reasons = [...result.unresolvedByReason].sort((left, right) => right[1] - left[1]);
  if (reasons.length > 0) lines.push("Exercised but UNRESOLVED, by reason:", "", "| Reason | Sites |", "|---|---|", ...reasons.map(([reason, count]) => `| ${reason} | ${count} |`), "");
  if (result.contradictions.length > 0) lines.push("Contradictions:", "", ...result.contradictions.slice(0, 50).map((line) => `- \`${line}\``), "");
  if (result.substitutions.length > 0) lines.push("Module substitutions by tests:", "", ...result.substitutions.slice(0, 20).map((line) => `- \`${line}\``), "");
  return lines.join("\n");
}
