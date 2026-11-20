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
  /** RESOLVED calls whose target names no function the oracle can find in the source, so it cannot judge them. */
  readonly unverifiable: number;
  readonly unverifiableByKind: ReadonlyMap<string, number>;
  readonly unverifiableExamples: readonly string[];
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

/**
 * The call a V8 caller position belongs to. Several calls can cover one position: `request(createApp())` reaches past
 * `request(` to its argument's start. The call that starts last is the innermost one there; among calls starting
 * together (`f().g()`) the shorter wins.
 */
export function innermostSite<Site extends { readonly from: number; readonly to: number }>(sites: readonly Site[], offset: number): Site | undefined {
  let best: Site | undefined;
  for (const site of sites) {
    if (site.from <= offset && offset <= site.to && (best === undefined || site.from > best.from || (site.from === best.from && site.to - site.from < best.to - best.from))) best = site;
  }
  return best;
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

/** What one instrumented test run saw: each call site, in original coordinates, and the functions it entered. */
export interface ObservedRun {
  readonly corpus: string;
  /** The analysed clean copy: its sources and its `.discovery`. */
  readonly clean: string;
  readonly testExit: number | null;
  readonly observed: ReadonlyMap<string, ReadonlySet<string>>;
  readonly instrumentedFiles: number;
  readonly skippedFiles: readonly string[];
}

/** Runs the oracle on one corpus directory with the engine at `engineRoot`. */
export function runCallOracle(engineRoot: string, corpus: string): OracleResult {
  const work = mkdtempSync(join(tmpdir(), "lx-call-oracle-"));
  try {
    return judgeRun(observeRun(engineRoot, corpus, work));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Analyses a clean copy of the corpus inside `work`, runs its tests instrumented and collects what they entered. */
export function observeRun(engineRoot: string, corpus: string, work: string): ObservedRun {
  // 1. The engine's facts, from a clean copy (no dependencies installed, as in the fact diff).
  const { name, script, clean } = analyzeCleanCopy(engineRoot, corpus, work);

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
  return { corpus: name, clean, testExit, observed, instrumentedFiles: insertions.size, skippedFiles };
}

/** Checks the engine's calls, from the clean copy's `.discovery`, against what the run observed. */
export function judgeRun(run: ObservedRun): OracleResult {
  const { clean, observed } = run;
  const semantic = JSON.parse(readFileSync(join(clean, ".discovery", "semantic.json"), "utf8"));
  const symbols: any[] = JSON.parse(readFileSync(join(clean, ".discovery", "symbols.json"), "utf8"));

  // 4. Each observed position -> the innermost call expression covering it -> the engine's call there.
  const sitesByFile = new Map<string, CallSite[]>();
  const siteFor = (file: string, line: number, column: number): CallSite | undefined => {
    let sites = sitesByFile.get(file);
    if (sites === undefined) {
      try { sites = callSites(file, readFileSync(join(clean, file), "utf8")); } catch { sites = []; }
      sitesByFile.set(file, sites);
    }
    const offset = offsetOf(join(clean, file), line, column);
    return innermostSite(sites, offset);
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
  const enteredFunction = targetFunctions((file) => { try { return readFileSync(join(clean, file), "utf8"); } catch { return undefined; } });

  let matchedSites = 0;
  let resolvedAgree = 0;
  let unverifiable = 0;
  const unverifiableByKind = new Map<string, number>();
  const unverifiableExamples: string[] = [];
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
    // An EXTERNAL call claims to leave the repository (ADR-012): entering a repository function contradicts it.
    if (call.resolutionState === "EXTERNAL") {
      const line = `${file}:${site!.start.line}:${site!.start.column} ${call.calleeName} -> engine EXTERNAL ${call.external?.module}:${call.external?.member}, observed ${[...callees].join(", ")}`;
      if ([...callees].every((callee) => usesProxyquire(splitPosition(callee)[0]))) substitutions.push(line);
      else contradictions.push(line);
      continue;
    }
    if (call.resolutionState !== "RESOLVED") {
      const reason = call.reason ?? "not-recorded";
      unresolvedByReason.set(reason, (unresolvedByReason.get(reason) ?? 0) + 1);
      continue;
    }
    // The call must enter exactly the function the target names: a nested function or a neighbour in the same
    // span is a different function (AUD-04).
    const target = follow(symbolById.get(call.targetSymbolId));
    const entered = target === undefined ? undefined : enteredFunction(target);
    const describe = `${file}:${site!.start.line}:${site!.start.column} ${call.calleeName} -> engine ${target?.kind}:${target?.name}@${target?.filePath}:${target?.location?.start.line}`;
    if (entered === undefined) {
      unverifiable++;
      unverifiableByKind.set(String(target?.kind), (unverifiableByKind.get(String(target?.kind)) ?? 0) + 1);
      if (unverifiableExamples.length < 20) unverifiableExamples.push(`${describe}, observed ${[...callees].join(", ")}`);
      continue;
    }
    const others = [...callees].filter((callee) => callee !== entered);
    if (others.length === 0) { resolvedAgree++; continue; }
    const finding = `${describe} (enters ${entered}), observed ${[...callees].join(", ")}`;
    if (others.every((callee) => usesProxyquire(splitPosition(callee)[0]))) substitutions.push(finding);
    else contradictions.push(finding);
  }
  return {
    corpus: run.corpus, testExit: run.testExit, observedSites: observed.size, matchedSites, resolvedAgree, contradictions, substitutions,
    unverifiable, unverifiableByKind, unverifiableExamples, unresolvedByReason, instrumentedFiles: run.instrumentedFiles, skippedFiles: run.skippedFiles,
  };
}

const WRAPPERS = new Set(["ParenthesizedExpression", "TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TypeCastExpression"]);

/** Calls `add` with each name a binding pattern binds. */
function patternNames(pattern: any, add: (name: string) => void): void {
  if (pattern === null || pattern === undefined) return;
  switch (pattern.type) {
    case "Identifier": add(pattern.name); return;
    case "AssignmentPattern": patternNames(pattern.left, add); return;
    case "RestElement": patternNames(pattern.argument, add); return;
    case "ArrayPattern": for (const element of pattern.elements) patternNames(element, add); return;
    case "ObjectPattern": for (const property of pattern.properties) patternNames(property.type === "RestElement" ? property : property.value, add); return;
    default: return;
  }
}

/**
 * One function's (or the program's) names. Blocks are folded into their function, so two block-scoped bindings of one
 * name in one function make it ambiguous: the oracle then names nothing, which only leaves a call unchecked.
 */
interface Scope {
  readonly parent: Scope | undefined;
  /** Per name: a declaration the oracle can read (function, class, `name = value` declarator), or null for any other binding. */
  readonly bindings: Map<string, any[]>;
}

/** One parsed source file: its nodes by start position, and the scope each node sits in. */
interface SourceIndex {
  readonly byStart: ReadonlyMap<string, readonly { readonly node: any; readonly parent: any }[]>;
  readonly scopeOf: ReadonlyMap<any, Scope>;
}

function indexSource(source: string): SourceIndex {
  const byStart = new Map<string, { readonly node: any; readonly parent: any }[]>();
  const scopeOf = new Map<any, Scope>();
  const bind = (scope: Scope, name: string, declaration: any): void => { scope.bindings.set(name, [...(scope.bindings.get(name) ?? []), declaration]); };
  const visit = (node: any, parent: any, scope: Scope): void => {
    const key = `${node.loc.start.line}:${node.loc.start.column}`;
    byStart.set(key, [...(byStart.get(key) ?? []), { node, parent }]);
    let inner = scope;
    if (FUNCTION_TYPES.has(node.type)) {
      if (node.type === "FunctionDeclaration" && node.id) bind(scope, node.id.name, node);
      inner = { parent: scope, bindings: new Map() };
      if (node.type === "FunctionExpression" && node.id) bind(inner, node.id.name, null);
      for (const param of node.params ?? []) patternNames(param, (name) => bind(inner, name, null));
    } else if (node.type === "ClassDeclaration" && node.id) bind(scope, node.id.name, node);
    else if (node.type === "ClassExpression" && node.id) bind(scope, node.id.name, null);
    else if (node.type === "VariableDeclarator") {
      if (node.id.type === "Identifier") bind(scope, node.id.name, node);
      else patternNames(node.id, (name) => bind(scope, name, null));
    } else if (node.type === "CatchClause") patternNames(node.param, (name) => bind(scope, name, null));
    else if (node.type === "ImportSpecifier" || node.type === "ImportDefaultSpecifier" || node.type === "ImportNamespaceSpecifier") bind(scope, node.local.name, null);
    scopeOf.set(node, inner);
    for (const field of Object.keys(node)) {
      if (field === "loc" || field === "leadingComments" || field === "trailingComments" || field === "innerComments" || field === "extra") continue;
      const value = node[field];
      if (Array.isArray(value)) { for (const child of value) if (child !== null && typeof child === "object" && typeof child.type === "string") visit(child, node, inner); }
      else if (value !== null && typeof value === "object" && typeof value.type === "string") visit(value, node, inner);
    }
  };
  visit(parseFile(source).program, undefined, { parent: undefined, bindings: new Map() });
  return { byStart, scopeOf };
}

/** The declaration a name refers to: the nearest scope that binds it, if it binds it once and readably. */
function declarationOf(index: SourceIndex, identifier: any): any {
  for (let scope = index.scopeOf.get(identifier); scope !== undefined; scope = scope.parent) {
    const bound = scope.bindings.get(identifier.name);
    if (bound !== undefined) return bound.length === 1 && bound[0] !== null ? bound[0] : undefined;
  }
  return undefined;
}

/**
 * The function a RESOLVED target names at run time, read from the target's own source at its position (not from the
 * engine's facts): the function or method itself, a class's constructor, or the function value of a declarator,
 * property, assignment or export. A plain name is followed to its declaration when the nearest function (or the
 * program) that binds it binds it once; a call is followed into a function whose every `return` gives the same
 * function (a factory). Returns the function's start as `file:line:column`, the position the instrumenter records on
 * entry, or undefined when the source holds no function the oracle can name there (an object, an unknown call
 * result, a class without a constructor). Naming nothing only leaves a call unchecked; it never makes one agree.
 */
export function targetFunctions(readSource: (file: string) => string | undefined): (symbol: any) => string | undefined {
  const indexes = new Map<string, SourceIndex | undefined>();
  const indexOf = (file: string): SourceIndex | undefined => {
    if (!indexes.has(file)) {
      const source = readSource(file);
      let index: SourceIndex | undefined;
      try { index = source === undefined ? undefined : indexSource(source); } catch { index = undefined; }
      indexes.set(file, index);
    }
    return indexes.get(file);
  };
  const constructorOf = (node: any): any => node.body.body.find((member: any) => member.type === "ClassMethod" && member.kind === "constructor");
  /** The `return` values of a function, outside its nested functions; undefined if one returns nothing. */
  const returnsOf = (fn: any): any[] | undefined => {
    if (fn.body.type !== "BlockStatement") return [fn.body];
    const values: any[] = [];
    let bare = false;
    const visit = (node: any): void => {
      if (node === null || typeof node !== "object") return;
      if (Array.isArray(node)) { for (const child of node) visit(child); return; }
      if (typeof node.type !== "string" || FUNCTION_TYPES.has(node.type) || node.type === "ClassBody") return;
      if (node.type === "ReturnStatement") { if (node.argument === null) bare = true; else values.push(node.argument); }
      for (const key of Object.keys(node)) if (key !== "loc" && key !== "extra" && !key.endsWith("Comments")) visit(node[key]);
    };
    visit(fn.body.body);
    return bare || values.length === 0 ? undefined : values;
  };
  const valueFunction = (file: string, value: any, depth: number): any => {
    let expression = value;
    while (expression !== null && expression !== undefined && WRAPPERS.has(expression.type)) expression = expression.expression;
    if (expression === null || expression === undefined || depth > 6) return undefined;
    if (FUNCTION_TYPES.has(expression.type)) return expression;
    switch (expression.type) {
      case "ClassExpression": return constructorOf(expression);
      case "AssignmentExpression": return expression.operator === "=" ? valueFunction(file, expression.right, depth + 1) : undefined;
      case "Identifier": {
        const index = indexOf(file);
        const declaration = index === undefined ? undefined : declarationOf(index, expression);
        return declaration === undefined ? undefined : nodeFunction(file, declaration, undefined, depth + 1);
      }
      case "CallExpression": {
        const factory = valueFunction(file, expression.callee, depth + 1);
        if (factory === undefined || factory.type === "ClassMethod") return undefined;
        const results = (returnsOf(factory) ?? []).map((result) => valueFunction(file, result, depth + 1));
        return results.length > 0 && results.every((result) => result !== undefined && result === results[0]) ? results[0] : undefined;
      }
      default: return undefined;
    }
  };
  const nodeFunction = (file: string, node: any, parent: any, depth: number): any => {
    if (FUNCTION_TYPES.has(node.type)) return node;
    switch (node.type) {
      case "ClassDeclaration": case "ClassExpression": return constructorOf(node);
      case "VariableDeclarator": return valueFunction(file, node.init, depth);
      case "ObjectProperty": case "ClassProperty": case "ClassPrivateProperty": return valueFunction(file, node.value, depth);
      case "AssignmentExpression": return node.operator === "=" ? valueFunction(file, node.right, depth) : undefined;
      case "ExpressionStatement": return node.expression.type === "AssignmentExpression" ? nodeFunction(file, node.expression, node, depth) : undefined;
      case "VariableDeclaration": return node.declarations.length === 1 ? nodeFunction(file, node.declarations[0], node, depth) : undefined;
      case "ExportNamedDeclaration": return node.declaration === null || node.declaration === undefined ? undefined : nodeFunction(file, node.declaration, node, depth);
      case "ExportDefaultDeclaration": return FUNCTION_TYPES.has(node.declaration.type) || node.declaration.type.startsWith("Class") ? nodeFunction(file, node.declaration, node, depth) : valueFunction(file, node.declaration, depth);
      default:
        // A name at the position: the key, id or assignment target of the declaration that holds the value.
        return parent !== undefined && (parent.key === node || parent.id === node || parent.left === node) ? nodeFunction(file, parent, undefined, depth) : undefined;
    }
  };
  return (symbol) => {
    const start = symbol?.location?.start;
    if (typeof symbol?.filePath !== "string" || start === undefined) return undefined;
    // Several nodes can start there, outermost first; inner ones start there only as parts of the outer one
    // (`exports.x = …` starts at `exports`). The first that names a function decides.
    for (const { node, parent } of indexOf(symbol.filePath)?.byStart.get(`${start.line}:${start.column}`) ?? []) {
      const found = nodeFunction(symbol.filePath, node, parent, 0);
      if (found !== undefined) return `${symbol.filePath}:${found.loc.start.line}:${found.loc.start.column}`;
    }
    return undefined;
  };
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
    `| RESOLVED, not checkable (the target names no function the oracle can find) | ${result.unverifiable} |`,
    `| Precision | ${precisionBase === 0 ? "n/a" : `${((100 * result.resolvedAgree) / precisionBase).toFixed(1)}%`} |`,
    `| Recall (agreeing / matched) | ${result.matchedSites === 0 ? "n/a" : `${((100 * result.resolvedAgree) / result.matchedSites).toFixed(1)}%`} |`,
    "",
  ];
  const reasons = [...result.unresolvedByReason].sort((left, right) => right[1] - left[1]);
  if (reasons.length > 0) lines.push("Exercised but UNRESOLVED, by reason:", "", "| Reason | Sites |", "|---|---|", ...reasons.map(([reason, count]) => `| ${reason} | ${count} |`), "");
  const kinds = [...result.unverifiableByKind].sort((left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : 1));
  if (kinds.length > 0) {
    lines.push("Not checkable, by target kind:", "", "| Target kind | Sites |", "|---|---|", ...kinds.map(([kind, count]) => `| ${kind} | ${count} |`), "");
    lines.push("First not-checkable sites:", "", ...result.unverifiableExamples.map((line) => `- \`${line}\``), "");
  }
  if (result.contradictions.length > 0) lines.push("Contradictions:", "", ...result.contradictions.slice(0, 50).map((line) => `- \`${line}\``), "");
  if (result.substitutions.length > 0) lines.push("Module substitutions by tests:", "", ...result.substitutions.slice(0, 20).map((line) => `- \`${line}\``), "");
  return lines.join("\n");
}
