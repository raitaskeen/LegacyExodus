/**
 * Canonical-semantics conformance corpus.
 *
 * Each case is a tiny repository plus the facts the engine must project for it. Facts are the
 * strings produced by `benchmarks/fact-diff.ts` (`extractFacts`), matched by regular expression
 * so that expectations name behaviour, not incidental ids. Cases with `runtime` are also
 * executed in a sandbox (with `req`/`res` stubs) to prove that the expected taint ground truth is
 * itself correct before the engine is judged against it.
 *
 * Adding a case: give every expectation a unique, stable id. If the engine does not meet it yet,
 * record the id in `known-gaps.ts` with the finding that owns the fix.
 */

import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";

export interface Expectation {
  readonly id: string;
  /** fact-diff category the regular expressions are matched against. */
  readonly category?: string;
  /** Some fact in the category matches. */
  readonly has?: RegExp;
  /** No fact in the category matches. */
  readonly lacks?: RegExp;
  /** Custom check over the raw `.discovery` directory, for facts outside fact-diff. */
  readonly check?: (discoveryDirectory: string) => boolean;
}

export interface ConformanceCase {
  readonly id: string;
  readonly files: Readonly<Record<string, string>>;
  /** Runtime ground truth for `p.js`: does tainted input reach `res.send`/`res.json`? */
  readonly runtime?: "flow" | "none";
  readonly expectations: readonly Expectation[];
}

const analyzed = (path: string): RegExp => new RegExp(`^${escape(path)}\\|analyzed$`);
function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** Taint snippets: `req` and `res` are free variables, as in an Express handler body. */
const taintSnippets: Readonly<Record<string, { readonly code: string; readonly runtime: "flow" | "none" }>> = {
  // F-004 reproduction (evidence/2026-10-audit/f004-design/cases.ts), loops.
  "f004-L1": { runtime: "flow", code: `let prev = "", cur = ""; for (const item of [1, 2]) { prev = cur; cur = req.body; } res.send(prev);` },
  "f004-L2": { runtime: "flow", code: `let prev = "", cur = "", i = 0; while (i < 2) { prev = cur; cur = req.body; i = i + 1; } res.send(prev);` },
  "f004-L3": { runtime: "flow", code: `let prev = "", cur = ""; for (let i = 0; i < 2; i++) { prev = cur; cur = req.body; } res.send(prev);` },
  "f004-L4": { runtime: "flow", code: `let prev = "", cur = "", i = 0; do { prev = cur; cur = req.body; i = i + 1; } while (i < 2); res.send(prev);` },
  "f004-L5": { runtime: "flow", code: `let v = req.body; for (const x of []) { v = "safe"; } res.send(v);` },
  "f004-L6": { runtime: "flow", code: `let v = req.body; const go = false; while (go) { v = "safe"; } res.send(v);` },
  "f004-L7": { runtime: "flow", code: `let v = req.body; for (const k in {}) { v = "safe"; } res.send(v);` },
  "f004-L8": { runtime: "flow", code: `let v = "", n = ""; for (let i = 0; i < 2; v = n, i++) { n = req.body; } res.send(v);` },
  "f004-L9": { runtime: "flow", code: `let v = ""; const c = true; while (true) { if (c) { v = req.body; break; } v = "safe"; } res.send(v);` },
  "f004-L10": { runtime: "flow", code: `let v = "", w = ""; for (const k of [1, 2]) { v = w; w = req.body; if (k === 1) continue; w = "safe"; } res.send(v);` },
  "f004-L11": { runtime: "flow", code: `let v = ""; outer: for (const a of [1]) { for (const b of [1]) { v = req.body; break outer; } v = "safe"; } res.send(v);` },
  "f004-L12": { runtime: "flow", code: `let v = req.body; for (const x of [1]) { res.send(v); v = "safe"; }` },
  // switch
  "f004-S1": { runtime: "flow", code: `let v = ""; const k = 1; switch (k) { case 1: v = req.body; break; case 2: v = "safe"; break; } res.send(v);` },
  "f004-S2": { runtime: "flow", code: `let v = req.body; const k = 3; switch (k) { case 1: v = "safe"; break; } res.send(v);` },
  "f004-S3": { runtime: "flow", code: `let v = "", w = ""; const k = 1; switch (k) { case 1: v = req.body; case 2: w = v; break; case 3: w = "safe"; } res.send(w);` },
  "f004-S4": { runtime: "flow", code: `let v = req.body; const k = 9; switch (k) { case 1: v = "safe"; break; default: res.send(v); }` },
  // try
  "f004-T1": { runtime: "flow", code: `let v = ""; function mayThrow() {} try { v = req.body; mayThrow(); } catch (e) { v = "fallback"; } res.send(v);` },
  "f004-T2": { runtime: "flow", code: `let v = "", w = ""; function mayThrow() { throw new Error("x"); } try { v = req.body; mayThrow(); v = "safe"; } catch (e) { w = v; } res.send(w);` },
  "f004-T3": { runtime: "flow", code: `let v = req.body; function mayThrow() { throw new Error("x"); } try { mayThrow(); v = "safe"; } catch (e) { res.send(v); }` },
  "f004-T4": { runtime: "flow", code: `let v = req.body; function mayThrow() { throw new Error("x"); } try { try { mayThrow(); v = "safe"; } finally { res.send(v); } } catch (e) {}` },
  // short-circuit and conditional expressions
  "f004-E1": { runtime: "flow", code: `let v = req.body; const c = false; c && (v = "safe"); res.send(v);` },
  "f004-E2": { runtime: "flow", code: `let v = req.body; const c = false; c ? (v = "safe") : 0; res.send(v);` },
  "f004-E3": { runtime: "flow", code: `let v = req.body; v ??= "safe"; res.send(v);` },
  "f004-E4": { runtime: "flow", code: `let v = req.body; v ||= "safe"; res.send(v);` },
  // controls that hold today
  "f004-C1": { runtime: "none", code: `let v = req.body; v = "safe"; res.send(v);` },
  "f004-C2": { runtime: "flow", code: `let v = ""; const c = true; if (c) { v = req.body; } else { v = "safe"; } res.send(v);` },
  "f004-C3": { runtime: "none", code: `for (const x of [1, 2]) { let v = req.body; v = "safe"; res.send(v); }` },
  // BA-04: a source passed straight into a sink.
  "direct-send": { runtime: "flow", code: `res.send(req.body);` },
  "direct-json-object": { runtime: "flow", code: `res.json({ data: req.body });` },
  "via-variable": { runtime: "flow", code: `const v = req.body; res.send(v);` },
  // BA-06: a branch condition is control, not data.
  "condition-not-data": { runtime: "none", code: `const x = req.query.flag ? "a" : "b"; res.send(x);` },
  // BA-07: aliasing the request object.
  "destructured-body": { runtime: "flow", code: `const { body } = req; res.send(body);` },
  // 2026-11-08 fresh audit taint probe (T1–T16), each proven by running it. Misses are owned gaps.
  "audit-property": { runtime: "flow", code: `const o = {}; o.p = req.body; res.send(o.p);` },
  "audit-array-element": { runtime: "flow", code: `const a = [req.body]; res.send(a[0]);` },
  "audit-template": { runtime: "flow", code: "res.send(`<b>${req.body}</b>`);" },
  "audit-callback": { runtime: "flow", code: `[req.body].forEach((v) => res.send(v));` },
  "audit-returned-object-field": { runtime: "flow", code: `function wrap(v) { return { inner: v }; } res.send(wrap(req.body).inner);` },
  "audit-getter": { runtime: "flow", code: `const o = { get p() { return req.body; } }; res.send(o.p);` },
  "audit-control-only": { runtime: "none", code: `res.send(req.body.length > 3 ? "ok" : "no");` },
  "audit-reassigned": { runtime: "none", code: `let v = req.body; v = "safe"; res.send(v);` },
};

const taintCases: readonly ConformanceCase[] = Object.entries(taintSnippets).map(([id, snippet]) => ({
  id: `taint-${id}`,
  files: { "p.js": snippet.code },
  runtime: snippet.runtime,
  expectations: [snippet.runtime === "flow"
    ? { id: `taint-${id}:flow`, category: "taint", has: /^p\.js\|/ }
    : { id: `taint-${id}:no-flow`, category: "taint", lacks: /^p\.js\|/ },
    { id: `taint-${id}:analyzed`, category: "dispositions", has: /^p\.js\|analyzed$/ }],
}));

export const conformanceCases: readonly ConformanceCase[] = [
  {
    id: "parse-dialects",
    files: {
      "src/cast.ts": "declare const someValue: unknown;\nexport const n = <number>someValue;\n",
      "src/generic-arrow.ts": "export const id = <T>(x: T): T => x;\n",
      "types/index.d.ts": "export declare const version: string;\nexport const limit: number;\n",
      "src/view.tsx": "export const View = () => <div>hi</div>;\n",
      "src/relational.js": "const a = 1, b = 2, c = 3;\nexport const r = a < b > (c);\n",
      "src/broken.js": "function (\n",
    },
    expectations: [
      { id: "parse:ts-angle-bracket-cast", category: "dispositions", has: analyzed("src/cast.ts") },
      { id: "parse:ts-generic-arrow", category: "dispositions", has: analyzed("src/generic-arrow.ts") },
      { id: "parse:dts-declaration-without-initializer", category: "dispositions", has: analyzed("types/index.d.ts") },
      { id: "parse:tsx-jsx", category: "dispositions", has: analyzed("src/view.tsx") },
      { id: "parse:js-relational-is-not-generic-call", category: "calls", lacks: /^src\/relational\.js@[^|]*\|[^|]*\|a\|/ },
      { id: "parse:syntax-error-fails", category: "dispositions", has: /^src\/broken\.js\|initial-parser-failure\|/ },
      { id: "parse:relational-js-analyzed", category: "dispositions", has: analyzed("src/relational.js") },
    ],
  },
  {
    id: "ts-declarations",
    files: {
      "src/defs.ts": [
        "export enum Color { Red, Green }",
        "export namespace NS { export function f(): number { return 1; } }",
        "export interface Shape { area(): number }",
        "export type Id = string;",
        "export abstract class Base { abstract run(): void }",
        "",
      ].join("\n"),
      "src/use.ts": [
        "import { Color, NS, Base } from './defs';",
        "import type { Shape, Id } from './defs';",
        "const s: Shape | undefined = undefined; const i: Id = 'x';",
        "console.log(Color.Red, NS.f(), s, i);",
        "export class Impl extends Base { run(): void {} }",
        "",
      ].join("\n"),
    },
    expectations: [
      { id: "ts:enum-export", category: "symbols", has: /^src\/defs\.ts\|export\|Color@/ },
      { id: "ts:namespace-export", category: "symbols", has: /^src\/defs\.ts\|export\|NS@/ },
      { id: "ts:interface-export", category: "symbols", has: /^src\/defs\.ts\|export\|Shape@/ },
      { id: "ts:type-alias-export", category: "symbols", has: /^src\/defs\.ts\|export\|Id@/ },
      { id: "ts:namespace-member-is-not-module-export", category: "symbols", lacks: /^src\/defs\.ts\|export\|f@/ },
      { id: "ts:enum-import-edge", category: "import-edges", has: /^import:Color@\S*@src\/use\.ts -> export:Color@\S*@src\/defs\.ts$/ },
      { id: "ts:class-import-edge", category: "import-edges", has: /^import:Base@\S*@src\/use\.ts -> export:Base@\S*@src\/defs\.ts$/ },
      { id: "ts:defs-analyzed", category: "dispositions", has: analyzed("src/defs.ts") },
    ],
  },
  {
    id: "ts-resolution",
    files: {
      "tsconfig.json": "{\n  // generated by tsc --init\n  \"compilerOptions\": {\n    \"baseUrl\": \".\",\n    \"paths\": { \"@lib/*\": [\"src/*\"] }, // alias\n  }\n}\n",
      "src/a.ts": "export function hello(): number { return 1; }\n",
      "src/b.ts": "import { hello } from './a.js';\nexport const fromJs = hello();\n",
      "src/c.ts": "import { hello } from '@lib/a';\nexport const fromAlias = hello();\n",
      "src/d.ts": "import { hello } from './a';\nexport const plain = hello();\n",
    },
    expectations: [
      { id: "resolve:ts-esm-js-extension", category: "module-edges", has: /^src\/b\.ts -> src\/a\.ts\|\.\/a\.js\|/ },
      { id: "resolve:jsonc-tsconfig-alias", category: "module-edges", has: /^src\/c\.ts -> src\/a\.ts\|@lib\/a\|/ },
      { id: "resolve:extensionless-relative", category: "module-edges", has: /^src\/d\.ts -> src\/a\.ts\|\.\/a\|/ },
    ],
  },
  {
    id: "express-routes",
    files: {
      "package.json": "{\"name\":\"routes\",\"dependencies\":{\"express\":\"4.21.2\"}}\n",
      "app.js": [
        "const express = require('express');",
        "const app = express();",
        "const admin = express.Router();",
        "function auth(req, res, next) { next(); }",
        "function handler(req, res) { res.send('ok'); }",
        "admin.use(auth);",
        "app.get('/public', handler);",
        "admin.get('/secret', handler);",
        "app.get('env');",
        "app.get('/x', auth, handler);",
        "app.use('/admin', admin);",
        "",
      ].join("\n"),
    },
    expectations: [
      { id: "express:route-found", category: "routes", has: /^app\.js\|GET \/public\|handler=handler\|/ },
      { id: "express:middleware-is-per-router", category: "routes", lacks: /^app\.js\|GET \/public\|[^|]*\|middleware=\[[^\]]*auth/ },
      { id: "express:settings-read-is-not-route", category: "routes", lacks: /^app\.js\|GET env\|/ },
      { id: "express:handler-is-last-argument", category: "routes", has: /^app\.js\|GET \/x\|handler=handler\|/ },
      { id: "express:mount-path-applied", category: "routes", has: /^app\.js\|GET \/admin\/secret\|/ },
      { id: "express:mounted-route-keeps-router-middleware", category: "routes", has: /^app\.js\|GET \/admin\/secret\|handler=handler\|middleware=\[auth\]\|/ },
      { id: "express:route-level-middleware", category: "routes", has: /^app\.js\|GET \/x\|handler=handler\|middleware=\[auth\]\|/ },
      { id: "express:router-is-not-middleware", category: "middlewareChains", lacks: /(^|[\[,])admin([,\]]|$)/ },
    ],
  },
  {
    // BA-08: middleware applies in registration order, only to routes registered after it, and through mounts.
    id: "express-order",
    files: {
      "server.js": [
        "const express = require('express');",
        "const app = express();",
        "const api = express.Router();",
        "function log(req, res, next) { next(); }",
        "function auth(req, res, next) { next(); }",
        "function limit(req, res, next) { next(); }",
        "function list(req, res) { res.json([]); }",
        "function health(req, res) { res.send('ok'); }",
        "app.use(express.json());",
        "app.use(log);",
        "app.get('/health', health);",
        "app.use(auth);",
        "api.use(limit);",
        "api.get('/items', list);",
        "app.use('/api/v1', api);",
        "app.use((req, res, next) => next());",
        "app.get(['/a', '/b'], list);",
        "app.get('/slash/', list);",
        "app.get(/^\\/re$/, list);",
        "",
      ].join("\n"),
    },
    expectations: [
      { id: "order:call-middleware-named", category: "routes", has: /^server\.js\|GET \/health\|handler=health\|middleware=\[express\.json\(\),log\]\|/ },
      { id: "order:later-middleware-not-applied", category: "routes", lacks: /^server\.js\|GET \/health\|[^|]*\|middleware=\[[^\]]*auth/ },
      { id: "order:mount-inherits-parent-then-router", category: "routes", has: /^server\.js\|GET \/api\/v1\/items\|handler=list\|middleware=\[express\.json\(\),log,auth,limit\]\|/ },
      { id: "order:unmounted-path-not-reported", category: "routes", lacks: /^server\.js\|GET \/items\|/ },
      { id: "order:path-array-registers-each-path", category: "routes", has: /^server\.js\|GET \/a\|handler=list\|middleware=\[express\.json\(\),log,auth,<anonymous>\]\|/ },
      { id: "order:path-array-second-path", category: "routes", has: /^server\.js\|GET \/b\|handler=list\|/ },
      { id: "order:trailing-slash-kept", category: "routes", has: /^server\.js\|GET \/slash\/\|handler=list\|/ },
      { id: "order:regex-path-is-dynamic", category: "routes", has: /^server\.js\|GET <dynamic>\|handler=list\|middleware=\[express\.json\(\),log,auth,<anonymous>\]\|/ },
    ],
  },
  {
    id: "namespace-import",
    files: {
      "lib.js": "export function a() { return 1; }\nexport function b() { return 2; }\n",
      "main.js": "import * as lib from './lib.js';\nlib.b();\n",
    },
    expectations: [
      { id: "namespace:call-resolves", category: "calls", has: /^main\.js@[^|]*\|module\|lib\.b\|RESOLVED\|export:b@/ },
      { id: "namespace:used-export-not-unused", category: "unusedExports", lacks: /\|export:b@\S*@lib\.js\|/ },
      { id: "namespace:no-arbitrary-export-edge", category: "import-edges", lacks: /^import:lib@\S*@main\.js -> export:a@/ },
      { id: "namespace:files-analyzed", category: "dispositions", has: analyzed("lib.js") },
    ],
  },
  {
    id: "dynamic-import",
    files: {
      "lib.js": "export function lazy() { return 1; }\n",
      "main.js": "export async function load() { const m = await import('./lib.js'); return m.lazy(); }\n",
    },
    expectations: [
      { id: "dynamic:literal-import-edge", category: "module-edges", has: /^main\.js -> lib\.js\|\.\/lib\.js\|/ },
      { id: "dynamic:target-not-unused", category: "unusedExports", lacks: /\|export:lazy@\S*@lib\.js\|/ },
      { id: "dynamic:lib-analyzed", category: "dispositions", has: analyzed("lib.js") },
      { id: "dynamic:main-analyzed", category: "dispositions", has: analyzed("main.js") },
    ],
  },
  {
    id: "class-expression",
    files: { "x.js": "class Outer { m() { return 1; } }\nexport const Inner = class { n() { return 2; } };\nnew Outer().m();\n" },
    expectations: [
      { id: "class:declaration-method-container", category: "symbols", has: /^x\.js\|method\|m@[^|]*\|[^|]*\|Outer$/ },
      { id: "class:expression-method-container", category: "symbols", has: /^x\.js\|method\|n@[^|]*\|[^|]*\|Inner$/ },
    ],
  },
  {
    id: "compiled-commonjs",
    files: {
      "lib.js": "\"use strict\";\nObject.defineProperty(exports, \"__esModule\", { value: true });\nexports.hello = void 0;\nfunction hello() { return 1; }\nexports.hello = hello;\n",
      "main.js": "\"use strict\";\nconst lib_1 = require(\"./lib\");\n(0, lib_1.hello)();\nlib_1.hello();\n",
    },
    expectations: [
      { id: "cjs:compiled-member-call-resolves", category: "calls", has: /^main\.js@4:0\|module\|lib_1\.hello\|RESOLVED\|/ },
      { id: "cjs:indirect-call-recorded", category: "calls", has: /^main\.js@3:\d+\|module\|lib_1\.hello\|/ },
    ],
  },
  {
    id: "discovery-policy",
    files: {
      "Gemfile": "source 'https://rubygems.org'\ngem 'rails', '~> 7.1'\n",
      "app/controllers/users_controller.rb": "class UsersController < ApplicationController\n  def index; end\nend\n",
      "app/views/components/card.html.erb": "<div><%= yield %></div>\n",
      "dist/bundle.min.js": "!function(){var a=1;function b(){return a}window.b=b}();\n",
    },
    expectations: [
      { id: "discovery:no-express-from-directory-name", category: "frameworks", lacks: /^express\|/ },
      { id: "discovery:no-react-from-directory-name", category: "frameworks", lacks: /^react\|/ },
      { id: "discovery:build-output-not-analyzed", category: "dispositions", lacks: /^dist\/bundle\.min\.js\|analyzed$/ },
      // Not analyzed, but never silently gone: it is listed, and as generated.
      { id: "discovery:build-output-listed-as-generated", category: "files", has: /^dist\/bundle\.min\.js\|javascript\|generated$/ },
      { id: "discovery:ruby-file-discovered", category: "files", has: /^app\/controllers\/users_controller\.rb\|ruby\|/ },
    ],
  },
  {
    // BA-15: gitignored paths are not the project's source; each is reported as excluded, not dropped.
    id: "discovery-gitignore",
    files: {
      ".gitignore": "out/\n*.log\n!keep.log\n",
      "src/app.js": "export function run() { return 1; }\nrun();\n",
      "out/app.js": "export function run() { return 2; }\n",
      "debug.log": "noise\n",
      "keep.log": "kept\n",
    },
    expectations: [
      { id: "gitignore:source-analyzed", category: "dispositions", has: analyzed("src/app.js") },
      { id: "gitignore:ignored-directory-not-discovered", category: "files", lacks: /^out\// },
      { id: "gitignore:negation-re-includes", category: "files", has: /^keep\.log\|/ },
      {
        id: "gitignore:exclusions-reported",
        check: (directory) => JSON.stringify(readJson(directory, "project.json").excludedPaths) === JSON.stringify([
          { path: "debug.log", kind: "file", reason: "gitignore" },
          { path: "out", kind: "directory", reason: "gitignore" },
        ]),
      },
    ],
  },
  {
    id: "cfg-structure",
    files: {
      "loops.js": "export function early(n) { for (let i = 0; i < n; i++) { return 1; } return 0; }\n",
      "finally.js": "export function f(n) { outer: for (let i = 0; i < n; i++) { let j = 0; while (j < n) { try { if (j) continue outer; j++; } finally { k(); } } } done(); }\nfunction k() {}\nfunction done() {}\n",
    },
    expectations: [
      { id: "cfg:loop-body-that-always-returns-has-no-loop", category: "cfg", has: /^loops\.js\|early@[^|]*\|[^|]*\|[^|]*\|[^|]*\|loops=0\|/ },
      { id: "cfg:statement-ids-unique-per-graph", check: (directory) => uniqueStatementIds(directory) },
      { id: "cfg:finally-graph-built", category: "cfg", has: /^finally\.js\|f@/ },
    ],
  },
  {
    // Branches inside expressions are blocks: `a && b`, `a ?? b`, `c ? x : y`, `x?.y`, `x ||= y`, also in loop tests.
    id: "cfg-expression-control",
    files: {
      "expr.js": [
        "export function pick(a, b) { const v = a ?? b; return a && b ? v : null; }",
        "export function call(svc, x) { svc?.run(x); x ||= 1; return x; }",
        "export function spin(a, b) { while (a && b()) { a = a.next; } return a; }",
        "export function later(a) { switch (a) { case a ?? 1: return 1; } return 0; }",
        "",
      ].join("\n"),
    },
    expectations: [
      { id: "cfg-expr:logical-and-conditional-resolved", category: "cfg", has: /^expr\.js\|pick@[^|]*\|[^|]*\|blocks=9\|edges=11\|loops=0\|unreachable=0\|dead=0\|state=RESOLVED$/ },
      { id: "cfg-expr:optional-and-logical-assignment-resolved", category: "cfg", has: /^expr\.js\|call@[^|]*\|.*\|state=RESOLVED$/ },
      { id: "cfg-expr:loop-test-lowered", category: "cfg", has: /^expr\.js\|spin@[^|]*\|.*\|loops=1\|.*\|state=RESOLVED$/ },
      { id: "cfg-expr:case-test-chain-resolved", category: "cfg", has: /^expr\.js\|later@[^|]*\|.*\|state=RESOLVED$/ },
    ],
  },
  {
    id: "projection",
    files: { "index.js": "export const a = 1;\n" },
    expectations: [
      { id: "projection:manifest-path-not-absolute", check: (directory) => !stringValues(readJson(directory, "manifest.json")).some(isAbsolutePath) },
      { id: "projection:no-artifact-records-project-location", check: (directory) => !recordsLocation(directory, dirname(directory)) },
    ],
  },
  {
    // BA-11: findings report only what is provably unused, and still report what is.
    id: "findings-precision",
    files: {
      "package.json": JSON.stringify({ name: "lib", main: "src/main.js" }),
      "src/main.js": "export function start() { return 1; }\n",
      "src/lib/index.js": "export { helper } from './util.js';\n",
      "src/lib/util.js": [
        "export function helper() { return 1; }",
        "export function unusedThing() { return 2; }",
        "const config = { key: 1, other: 2 };",
        "export class Box { method() { return config.key; } }",
        "function deadLocal() { return 0; }",
        "const _ignored = 1;",
        "",
      ].join("\n"),
      "src/app.js": "import { helper } from './lib/index.js';\nimport { Box } from './lib/util.js';\nhelper();\nnew Box();\n",
      "src/locals.ts": [
        "export function copy(source: { a?: number }): object {",
        "  const leftover = 1;",
        "  const merged = { ...source };",
        "  return source?.a === 1 ? merged : {};",
        "}",
        "export class Store {",
        "  constructor(private readonly backend: string) {}",
        "  read(): string { return this.backend; }",
        "}",
        "export const pick = (first: number, second: number) => second;",
        "export const head = (front: number, tail: number) => front;",
        "",
      ].join("\n"),
    },
    expectations: [
      { id: "findings:barrel-reexport-used", category: "unusedExports", lacks: /\|export:helper@\S*@src\/lib\/index\.js\|/ },
      { id: "findings:entry-module-exports-are-public", category: "unusedExports", lacks: /\|export:start@\S*@src\/main\.js\|/ },
      { id: "findings:unused-export-still-reported", category: "unusedExports", has: /\|export:unusedThing@\S*@src\/lib\/util\.js\|/ },
      { id: "findings:object-keys-are-not-dead-locals", category: "deadCode", lacks: /\|variable:(key|other)@/ },
      { id: "findings:class-members-are-not-dead-locals", category: "deadCode", lacks: /\|method:method@/ },
      { id: "findings:underscore-binding-intentional", category: "deadCode", lacks: /\|variable:_ignored@/ },
      { id: "findings:dead-local-still-reported", category: "deadCode", has: /^unreferenced-local-symbol\|function:deadLocal@\S*@src\/lib\/util\.js\|/ },
      { id: "findings:local-of-exported-function-reported", category: "deadCode", has: /^unreferenced-local-symbol\|variable:leftover@\S*@src\/locals\.ts\|/ },
      { id: "findings:spread-does-not-hide-references", category: "deadCode", lacks: /\|variable:source@/ },
      { id: "findings:parameter-property-is-a-member", category: "deadCode", lacks: /\|variable:backend@/ },
      { id: "findings:parameter-before-used-one-kept", category: "deadCode", lacks: /\|variable:first@/ },
      { id: "findings:trailing-unused-parameter-reported", category: "deadCode", has: /^unreferenced-local-symbol\|variable:tail@\S*@src\/locals\.ts\|/ },
    ],
  },
  {
    // BA-24: under the classic JSX runtime, JSX uses React; it is never claimed unused there.
    id: "jsx-react-import",
    files: {
      "src/Card.jsx": "import React from 'react';\nimport { unused } from './helpers.js';\nexport function Card() { return <div>hi</div>; }\n",
      "src/helpers.js": "export const unused = 1;\n",
      "src/main.js": "import { Card } from './Card.jsx';\nCard();\n",
    },
    expectations: [
      { id: "jsx:react-import-used-by-jsx", category: "unusedImports", lacks: /\|import:React@/ },
      { id: "jsx:other-unused-import-still-reported", category: "unusedImports", has: /\|import:unused@\S*@src\/Card\.jsx\|/ },
    ],
  },
  {
    // Review of #228: handler forms and request fields the policy must reach, and a sanitizer it must not trust.
    id: "taint-policy-handlers",
    files: {
      "app.js": [
        "const express = require('express');",
        "const { exec } = require('child_process');",
        "const controller = { create(request, response) { exec(request.body.a); } };",
        "class Users { list(request, response) { exec(request.query.b); } }",
        "const users = new Users();",
        "const router = new express.Router();",
        "router.post('/m', controller.create);",
        "router.get('/u', users.list.bind(users));",
        "let app;",
        "app = express();",
        "const handler = (request, response) => { exec(request.query.c); };",
        "app.get('/h', handler);",
        "app.post('/d', ({ body }, response) => { exec(body.cmd); });",
        "app.route('/r').get((request, response) => { response.redirect(request.originalUrl); });",
        "app.get('/u2', (request, response) => { response.redirect(request.url); });",
        "function sanitize(x) { return x; }",
        "app.get('/s', (request, response) => { exec(sanitize(request.query.d)); });",
        "",
      ].join("\n"),
    },
    expectations: [
      { id: "policy:object-method-handler", check: (directory) => taintKeys(directory).some((key) => key.includes("source:request.body.a@") && key.includes("sink:child_process.exec@")) },
      { id: "policy:bound-class-method-on-new-router", check: (directory) => taintKeys(directory).some((key) => key.includes("source:request.query.b@")) },
      { id: "policy:const-bound-handler", check: (directory) => taintKeys(directory).some((key) => key.includes("source:request.query.c@")) },
      { id: "policy:destructured-request-param", check: (directory) => taintKeys(directory).some((key) => key.includes("source:body.cmd@")) },
      { id: "policy:route-chain-and-original-url", check: (directory) => taintKeys(directory).some((key) => key.includes("source:request.originalUrl@") && key.includes("sink:res.redirect@")) },
      { id: "policy:request-url-source", check: (directory) => taintKeys(directory).some((key) => key.includes("source:request.url@")) },
      { id: "policy:local-sanitize-is-not-trusted", check: (directory) => taintKeys(directory).some((key) => key.includes("source:request.query.d@")) },
    ],
  },
  {
    // BA-07: the taint policy follows what names resolve to (s06-taint's handlers, plus controls).
    id: "taint-policy",
    files: {
      "app.js": [
        "const express = require('express');",
        "const { exec } = require('child_process');",
        "const vm = require('node:vm');",
        "const escapeHtml = require('escape-html');",
        "const app = express();",
        "app.post('/renamed', (request, response) => { response.send(request.body); });",
        "app.post('/exec', (req, res) => { exec(req.query.cmd); });",
        "app.post('/headers', (req, res) => { const v = req.headers['x-user']; res.send(v); });",
        "app.post('/eval', (req, res) => { eval(req.body.code); });",
        "app.post('/write', (req, res) => { res.write(req.body); });",
        "app.post('/redirect', (req, res) => { res.redirect(req.query.next); });",
        "app.post('/get', (req, res) => { res.send(req.get('x-forwarded-for')); });",
        "app.post('/vm', (req, res) => { vm.runInNewContext(req.body.script); });",
        "app.post('/nested', (req, res) => { const { body: { name } } = req; res.send(name); });",
        "app.post('/escaped', (req, res) => { res.send(escapeHtml(req.body.name)); });",
        "function local(cmd) { return cmd; }",
        "app.post('/local', (req, res) => { local(req.body); });",
        "",
      ].join("\n"),
    },
    expectations: [
      { id: "policy:renamed-handler-params", category: "taint", has: /^app\.js\|.*\|sink=#[0-9a-z]+:res\.send\|/ },
      { id: "policy:destructured-require-sink", category: "taint", has: /^app\.js\|.*\|sink=#[0-9a-z]+:child_process\.exec\|/ },
      { id: "policy:global-eval-sink", category: "taint", has: /^app\.js\|.*\|sink=#[0-9a-z]+:eval\|/ },
      { id: "policy:response-write-sink", category: "taint", has: /^app\.js\|.*\|sink=#[0-9a-z]+:res\.write\|/ },
      { id: "policy:response-redirect-sink", category: "taint", has: /^app\.js\|.*\|sink=#[0-9a-z]+:res\.redirect\|/ },
      { id: "policy:node-prefixed-module-sink", category: "taint", has: /^app\.js\|.*\|sink=#[0-9a-z]+:vm\.runInNewContext\|/ },
      { id: "policy:local-function-is-not-a-sink", category: "taint", lacks: /\|sink=#[0-9a-z]+:local\|/ },
      {
        id: "policy:sanitizer-cuts-and-every-handler-flows",
        // One flow per tainted handler: renamed, exec, headers, eval, write, redirect, get, vm, nested; not escaped, not local.
        check: (directory) => readJson(directory, "data-flow.json").graphs.flatMap((graph: { taintFlows: unknown[] }) => graph.taintFlows).length === 9,
      },
    ],
  },
  {
    // S3: a workspace package imported by name resolves to its source, like a relative import.
    id: "workspace-package",
    files: {
      "package.json": JSON.stringify({ name: "acme", private: true, workspaces: ["packages/*"] }),
      "packages/util/package.json": JSON.stringify({ name: "@acme/util", main: "build/index.js", exports: { ".": { source: "./src/index.js", default: "./build/index.js" } } }),
      "packages/util/src/index.js": "export function greet(name) { return `hi ${name}`; }\n",
      "app/main.js": "import { greet } from '@acme/util';\ngreet('x');\n",
    },
    expectations: [
      { id: "workspace:module-edge-to-package-source", category: "module-edges", has: /^app\/main\.js -> packages\/util\/src\/index\.js\|@acme\/util\|/ },
      { id: "workspace:call-resolves-across-packages", category: "calls", has: /^app\/main\.js@[^|]*\|module\|greet\|RESOLVED\|export:greet@\S*@packages\/util\/src\/index\.js/ },
      { id: "workspace:package-analyzed", category: "dispositions", has: analyzed("packages/util/src/index.js") },
    ],
  },
  {
    // BA-04 across files: a source passed straight into another file's function (Wave 3c).
    id: "taint-cross-file-direct",
    files: {
      "helpers.js": "export function reply(res, value) { res.send(value); }\nexport function pass(value) { return value; }\n",
      "app.js": "import { reply, pass } from './helpers.js';\nexport function a(req, res) { reply(res, req.body); }\nexport function b(req, res) { const v = pass(req.query); res.json(v); }\n",
    },
    expectations: [
      { id: "taint-cross-file-direct:argument-reaches-callee-sink", category: "taint", has: /^helpers\.js\|.*\|sink=#[0-9a-z]+:res\.send\|/ },
      { id: "taint-cross-file-direct:returned-reaches-caller-sink", category: "taint", has: /^app\.js\|.*\|sink=#[0-9a-z]+:res\.json\|/ },
      { id: "taint-cross-file-direct:helpers-analyzed", category: "dispositions", has: analyzed("helpers.js") },
    ],
  },
  {
    // 2026-11-08 audit probe T16: string-built SQL through a client instance is SQL injection.
    id: "taint-sql-client",
    files: {
      "db.js": "const mysql = require(\"mysql\");\nconst conn = mysql.createConnection({});\nexports.find = function find(req, res) { conn.query(\"SELECT * FROM users WHERE id = \" + req.query.id, () => {}); };\n",
    },
    expectations: [
      { id: "taint-sql:client-query", category: "taint", has: /^db\.js\|.*\|sink=#[0-9a-z]+:[^|]*query\|/ },
    ],
  },
  {
    // NA-09: a name the call graph cannot pin to one declaration is still used. Duplicate sloppy declarations
    // and an Annex B block function called after its block are not dead code; a function nothing names is.
    id: "dead-code-unresolved-names",
    files: {
      "sloppy.cjs": [
        "function dup() { return d(); }",
        "function d() { return \"first\"; }",
        "function d() { return \"second\"; }",
        "function annexB(x) { if (x) { function bf() { return 1; } } return bf(); }",
        "function neverCalled() { return 0; }",
        "module.exports = { dup, annexB };",
        "",
      ].join("\n"),
    },
    expectations: [
      { id: "dead-code:duplicate-declaration-is-used", category: "deadCode", lacks: /^unreferenced-local-symbol\|function:d@/ },
      { id: "dead-code:annex-b-function-is-used", category: "deadCode", lacks: /^unreferenced-local-symbol\|function:bf@/ },
      { id: "dead-code:unnamed-function-is-dead", category: "deadCode", has: /^unreferenced-local-symbol\|function:neverCalled@/ },
    ],
  },
  {
    // NA-03b: path-traversal and SSRF sinks, judged only on the argument that names the path or the URL.
    id: "taint-fs-ssrf-sinks",
    files: {
      "read.js": "const fs = require(\"fs\");\nexports.r = function r(req, res) { fs.readFile(req.params.p, () => {}); };\n",
      "write-path.js": "const { writeFile } = require(\"fs/promises\");\nexports.w = function w(req, res) { return writeFile(req.query.f, \"x\"); };\n",
      "write-data.js": "const fs = require(\"node:fs\");\nexports.d = function d(req, res) { fs.writeFileSync(\"log.txt\", req.body); };\n",
      "ssrf.js": "const https = require(\"https\");\nexports.s = function s(req, res) { https.get(req.query.url, () => {}); };\n",
      "fetch.js": "exports.f = async function f(req, res) { return fetch(req.query.u); };\n",
      "fetch-body.js": "exports.b = async function b(req, res) { return fetch(\"https://api.example\", { method: \"POST\", body: req.body }); };\n",
    },
    expectations: [
      { id: "taint-fs:read-path", category: "taint", has: /^read\.js\|.*\|sink=#[0-9a-z]+:fs\.readFile\|/ },
      { id: "taint-fs:write-path", category: "taint", has: /^write-path\.js\|.*\|sink=#[0-9a-z]+:fs\/promises\.writeFile\|/ },
      { id: "taint-fs:written-data-is-not-a-path", category: "taint", lacks: /^write-data\.js\|/ },
      { id: "taint-ssrf:https-get-url", category: "taint", has: /^ssrf\.js\|.*\|sink=#[0-9a-z]+:https\.get\|/ },
      { id: "taint-ssrf:fetch-url", category: "taint", has: /^fetch\.js\|.*\|sink=#[0-9a-z]+:fetch\|/ },
      { id: "taint-ssrf:fetch-body-is-not-the-url", category: "taint", lacks: /^fetch-body\.js\|/ },
    ],
  },
  {
    // NA-03: a proven call into another file whose result is used directly (a sink argument, an argument of
    // another call), with no variable receiving it, still carries the callee's return value.
    id: "taint-cross-file-nested",
    files: {
      "helpers.js": "function id(v) { return v; }\nfunction constant(v) { return \"ok\"; }\nmodule.exports = { id, constant };\n",
      "app.js": "const { id } = require(\"./helpers.js\");\nexports.a = function a(req, res) { res.send(id(req.body)); };\n",
      "chain.js": "const { id } = require(\"./helpers.js\");\nexports.c = function c(req, res) { res.json(id(id(req.query))); };\n",
      "safe.js": "const { constant } = require(\"./helpers.js\");\nexports.b = function b(req, res) { res.send(constant(req.body)); };\n",
    },
    expectations: [
      { id: "taint-cross-file-nested:result-reaches-sink", category: "taint", has: /^app\.js\|.*\|sink=#[0-9a-z]+:res\.send\|/ },
      { id: "taint-cross-file-nested:nested-results-reach-sink", category: "taint", has: /^chain\.js\|.*\|sink=#[0-9a-z]+:res\.json\|/ },
      { id: "taint-cross-file-nested:constant-result-stays-clean", category: "taint", lacks: /^safe\.js\|/ },
    ],
  },
  {
    // NA-01: every call site is a fact. A callee with no name (a call result, `new`, a computed key, a
    // function value, `super`) is an explicit UNRESOLVED call, never absent; a tagged template calls its tag.
    id: "call-site-completeness",
    files: {
      "calls.js": [
        "function mk() { return { run() { return 1; } }; }",
        "class K { m() { return 1; } }",
        "class S extends K { constructor() { super(); } m() { return super.m(); } }",
        "export function c1() { return mk().run(); }",
        "export function c2() { return new K().m(); }",
        "export function c3(p) { return p.then(mk).catch(mk); }",
        "export function c4(o, k) { return o[k](); }",
        "export function c5(arr) { return arr.map(mk)[0].run(); }",
        "export function c6() { return mk`tpl`; }",
        "export function c7() { return (() => 1)(); }",
        "export function c8() { return new (mk())(); }",
        "export function c9(q) { return q.a().b().c(); }",
        "export { S };",
        "",
      ].join("\n"),
    },
    expectations: [
      { id: "call-site:call-result-member", category: "calls", has: /^calls\.js@4:\d+\|c1\|mk\(\)\.run\|UNRESOLVED\|/ },
      { id: "call-site:call-result-inner-still-resolves", category: "calls", has: /^calls\.js@4:\d+\|c1\|mk\|RESOLVED\|/ },
      { id: "call-site:new-result-member", category: "calls", has: /^calls\.js@5:\d+\|c2\|new K\(\)\.m\|UNRESOLVED\|/ },
      { id: "call-site:chained-member", category: "calls", has: /^calls\.js@6:\d+\|c3\|p\.then\(\)\.catch\|UNRESOLVED\|/ },
      { id: "call-site:computed-member", category: "calls", has: /^calls\.js@7:\d+\|c4\|o\[<dynamic>\]\|UNRESOLVED\|/ },
      { id: "call-site:element-member", category: "calls", has: /^calls\.js@8:\d+\|c5\|arr\.map\(\)\[0\]\.run\|UNRESOLVED\|/ },
      { id: "call-site:tagged-template-resolves", category: "calls", has: /^calls\.js@9:\d+\|c6\|mk\|RESOLVED\|/ },
      { id: "call-site:function-value", category: "calls", has: /^calls\.js@10:\d+\|c7\|<function>\|UNRESOLVED\|/ },
      { id: "call-site:new-of-call-result", category: "calls", has: /^calls\.js@11:\d+\|c8\|mk\(\)\|UNRESOLVED\|/ },
      { id: "call-site:chain-first-link", category: "calls", has: /^calls\.js@12:\d+\|c9\|q\.a\(\)\.b\|UNRESOLVED\|/ },
      { id: "call-site:chain-name-is-bounded", category: "calls", has: /^calls\.js@12:\d+\|c9\|<dynamic>\(\)\.c\|UNRESOLVED\|/ },
      { id: "call-site:super-constructor", category: "calls", has: /^calls\.js@3:\d+\|[^|]*\|super\|UNRESOLVED\|/ },
      { id: "call-site:super-member", category: "calls", has: /^calls\.js@3:\d+\|[^|]*\|super\.m\|UNRESOLVED\|/ },
      { id: "call-site:no-synthetic-name-resolves", category: "calls", lacks: /^calls\.js@[^|]*\|[^|]*\|[^|]*(?:\(\)|<|\[|super)[^|]*\|RESOLVED\|/ },
      {
        id: "call-site:every-site-is-a-fact",
        check: (discoveryDirectory) => {
          const semantic = JSON.parse(readFileSync(join(discoveryDirectory, "semantic.json"), "utf8")) as { calls: { sourceFilePath: string }[] };
          return semantic.calls.filter((call) => call.sourceFilePath === "calls.js").length === 18;
        },
      },
    ],
  },
  {
    // NA-02: `with` and direct `eval` make names dynamic. In a `with` body a name bound outside it may be a
    // property of the object; a direct `eval` can declare or reassign any binding it can see, so no call
    // in its file is proven and its exports are unstable for other files.
    id: "dynamic-scope",
    files: {
      "with.cjs": [
        "function g() { return 1; }",
        "function w(o) { with (o) { return g(); } }",
        "function inner(o) { with (o) { function h() { return 2; } return h(); } }",
        "function after(o) { with (o) {} return g(); }",
        "module.exports = { w, inner, after };",
        "",
      ].join("\n"),
      "evil.cjs": [
        "function k() { return 1; }",
        "function ev(code) { eval(code); return k(); }",
        "function other() { return k(); }",
        "module.exports = { k, ev, other };",
        "",
      ].join("\n"),
      "user.cjs": "const { k } = require(\"./evil.cjs\");\nk();\nfunction m() { return 1; }\nm();\n",
    },
    expectations: [
      { id: "dynamic-scope:with-outer-name-unresolved", category: "calls", has: /^with\.cjs@2:\d+\|w\|g\|UNRESOLVED\|/ },
      { id: "dynamic-scope:with-inner-binding-resolves", category: "calls", has: /^with\.cjs@3:\d+\|inner\|h\|RESOLVED\|/ },
      { id: "dynamic-scope:after-with-resolves", category: "calls", has: /^with\.cjs@4:\d+\|after\|g\|RESOLVED\|/ },
      { id: "dynamic-scope:eval-function-unresolved", category: "calls", has: /^evil\.cjs@2:\d+\|ev\|k\|UNRESOLVED\|/ },
      { id: "dynamic-scope:eval-file-unresolved", category: "calls", has: /^evil\.cjs@3:\d+\|other\|k\|UNRESOLVED\|/ },
      { id: "dynamic-scope:eval-export-unstable", category: "calls", has: /^user\.cjs@2:\d+\|module\|k\|UNRESOLVED\|/ },
      { id: "dynamic-scope:clean-file-resolves", category: "calls", has: /^user\.cjs@4:\d+\|module\|m\|RESOLVED\|/ },
    ],
  },
  ...taintCases,
];

/** Keys of every taint flow in the analysis (each names its source and its sink). */
function taintKeys(directory: string): string[] {
  return (readJson(directory, "data-flow.json").graphs ?? []).flatMap((graph: any) => (graph.taintFlows ?? []).map((flow: any) => String(flow.key ?? "")));
}

function readJson(directory: string, name: string): any {
  return JSON.parse(readFileSync(join(directory, name), "utf8"));
}

/** BA-26: a shared `.discovery` must not reveal where the project lives, in any spelling of the path. */
function recordsLocation(directory: string, location: string): boolean {
  const spellings = [location, realpathSync.native(location)].flatMap((path) => [path, path.replaceAll("\\", "/"), JSON.stringify(path).slice(1, -1)]);
  return readdirSync(directory).filter((name) => name.endsWith(".json")).some((name) => {
    const text = readFileSync(join(directory, name), "utf8");
    return spellings.some((spelling) => text.includes(spelling));
  });
}

function stringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value === null || typeof value !== "object") return [];
  return Object.values(value).flatMap(stringValues);
}

function isAbsolutePath(path: string): boolean {
  return /^([a-zA-Z]:[\\/]|[\\/])/.test(path);
}

function uniqueStatementIds(directory: string): boolean {
  return readJson(directory, "control-flow.json").graphs.every((graph: any) => {
    const ids = graph.blocks.flatMap((block: any) => block.statements.map((statement: any) => statement.id));
    return new Set(ids).size === ids.length;
  });
}
