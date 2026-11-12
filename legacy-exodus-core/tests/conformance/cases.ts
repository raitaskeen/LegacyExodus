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
  "audit-callback-index-is-not-the-element": { runtime: "none", code: `[req.body].forEach((v, i) => res.send(i));` },
  "audit-returned-object-field": { runtime: "flow", code: `function wrap(v) { return { inner: v }; } res.send(wrap(req.body).inner);` },
  "audit-getter": { runtime: "flow", code: `const o = { get p() { return req.body; } }; res.send(o.p);` },
  "audit-control-only": { runtime: "none", code: `res.send(req.body.length > 3 ? "ok" : "no");` },
  "audit-reassigned": { runtime: "none", code: `let v = req.body; v = "safe"; res.send(v);` },
  // XB-01 (audit B): arrow functions and function expressions carry their parameters and returns like declarations.
  "xb01-arrow-helper": { runtime: "flow", code: `const send = (v) => res.send(v); send(req.body);` },
  "xb01-arrow-block-helper": { runtime: "flow", code: `const send = (v) => { res.send(v); }; send(req.body);` },
  "xb01-function-expression-helper": { runtime: "flow", code: `const send = function (v) { res.send(v); }; send(req.body);` },
  "xb01-named-function-expression": { runtime: "flow", code: `const send = function inner(v) { res.send(v); }; send(req.body);` },
  "xb01-arrow-return": { runtime: "flow", code: `const id = (v) => v; res.send(id(req.body));` },
  "xb01-arrow-ignores-argument": { runtime: "none", code: `const send = (v) => res.send("safe"); send(req.body);` },
  "xb01-arrow-returns-constant": { runtime: "none", code: `const clean = (v) => "safe"; res.send(clean(req.body));` },
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
    // XA-01: an HTML escaper protects the response body only. Behind it, a file path, a command and a redirect
    // stay tainted (in Node, escape-html returns "../../etc/passwd" and "ls; rm -rf /tmp/x" unchanged).
    id: "sanitizer-sink-kinds",
    files: {
      "app.js": [
        "const express = require('express');",
        "const fs = require('fs');",
        "const { execSync } = require('child_process');",
        "const escapeHtml = require('escape-html');",
        "const app = express();",
        "app.get('/file', (req, res) => { res.send(fs.readFileSync(escapeHtml(req.query.name), 'utf8')); });",
        "app.get('/run', (req, res) => { execSync(escapeHtml(req.query.cmd)); });",
        "app.get('/stored', (req, res) => { const safe = escapeHtml(req.query.path); fs.readFileSync(safe); });",
        "app.get('/next', (req, res) => { res.redirect(escapeHtml(req.query.next)); });",
        "app.get('/page', (req, res) => { const safe = escapeHtml(req.query.q); res.send('<p>' + safe + '</p>'); });",
        "",
      ].join("\n"),
    },
    expectations: [
      { id: "sanitized:file-path-still-tainted", check: (directory) => taintKeys(directory).some((key) => key.includes("source:req.query.name@") && key.includes("sink:fs.readFileSync@")) },
      { id: "sanitized:command-still-tainted", check: (directory) => taintKeys(directory).some((key) => key.includes("source:req.query.cmd@") && key.includes("sink:child_process.execSync@")) },
      { id: "sanitized:stored-value-still-tainted", check: (directory) => taintKeys(directory).some((key) => key.includes("source:req.query.path@") && key.includes("sink:fs.readFileSync@")) },
      { id: "sanitized:redirect-still-tainted", check: (directory) => taintKeys(directory).some((key) => key.includes("source:req.query.next@") && key.includes("sink:res.redirect@")) },
      { id: "sanitized:response-body-stays-clean", category: "taint", lacks: /\|sink=#[0-9a-z]+:res\.send\|/ },
      // The sanitized mark is internal: no source id written to data-flow.json carries it.
      { id: "sanitized:mark-never-written", check: (directory) => !JSON.stringify(readJson(directory, "data-flow.json")).includes("\\u0000") },
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
    // NA-12: a call that runs before its function is assigned calls `undefined`; nothing is proven. A hoisted
    // declaration, a call after the assignment, and a closure that may run later stay resolved.
    id: "call-before-assignment",
    files: {
      "a.js": [
        "function hoist() { f(); var f = function () { return 3; }; }",
        "function decl() { g(); function g() { return 1; } }",
        "function later() { var k = function () { return 1; }; return k(); }",
        "function closure() { const run = () => m(); var m = function () { return 2; }; return run(); }",
        "class S { ghost = this.#make(); #make() { return 1; } }",
        "module.exports = { hoist, decl, later, closure, S };",
        "",
      ].join("\n"),
    },
    expectations: [
      { id: "call-before-assignment:unresolved", category: "calls", has: /^a\.js@1:\d+\|hoist\|f\|UNRESOLVED\|/ },
      { id: "call-before-assignment:hoisted-declaration-resolves", category: "calls", has: /^a\.js@2:\d+\|decl\|g\|RESOLVED\|/ },
      { id: "call-before-assignment:after-assignment-resolves", category: "calls", has: /^a\.js@3:\d+\|later\|k\|RESOLVED\|/ },
      { id: "call-before-assignment:closure-resolves", category: "calls", has: /^a\.js@4:\d+\|[^|]*\|m\|RESOLVED\|/ },
      // A method exists once its class does, before any field initializer runs.
      { id: "call-before-assignment:method-from-field-resolves", category: "calls", has: /^a\.js@5:\d+\|[^|]*\|this\.#make\|RESOLVED\|/ },
    ],
  },
  {
    // A `require` inside a function binds its import there, not in the module. The call resolves while that
    // import is the one binding it sees; a parameter of the same name, a reassignment or a call outside that
    // function keeps it UNRESOLVED.
    id: "scoped-require",
    files: {
      "obj.js": "function createLogger() { return 1; }\nmodule.exports = { createLogger };\n",
      "alt.js": "function createLogger() { return 2; }\nmodule.exports = { createLogger };\n",
      "a.js": [
        "function inner() { const { createLogger } = require('./obj.js'); return createLogger(); }",
        "function param(createLogger) { return createLogger(); }",
        "function rebound() { let { createLogger } = require('./obj.js'); createLogger = () => 0; return createLogger(); }",
        "function second() { const { createLogger } = require('./alt.js'); return createLogger(); }",
        "function outside() { return createLogger(); }",
        "module.exports = { inner, param, rebound, second, outside };",
        "",
      ].join("\n"),
    },
    expectations: [
      { id: "scoped-require:resolves", category: "calls", has: /^a\.js@1:\d+\|inner\|createLogger\|RESOLVED\|/ },
      { id: "scoped-require:parameter-unresolved", category: "calls", has: /^a\.js@2:\d+\|param\|createLogger\|UNRESOLVED\|/ },
      { id: "scoped-require:rebound-unresolved", category: "calls", has: /^a\.js@3:\d+\|rebound\|createLogger\|UNRESOLVED\|/ },
      { id: "scoped-require:other-module-resolves", category: "calls", has: /^a\.js@4:\d+\|second\|createLogger\|RESOLVED\|/ },
      // Outside the function that required it the name is unbound: calling it throws, nothing is proven.
      { id: "scoped-require:outside-unresolved", category: "calls", has: /^a\.js@5:\d+\|outside\|createLogger\|UNRESOLVED\|/ },
    ],
  },
  {
    // `require("..")` in a package's tests loads the package through its package.json `main`, before any
    // index file (Node's directory resolution). Fastify's tests call it this way about a thousand times.
    id: "directory-main",
    files: {
      "package.json": "{ \"name\": \"probe\", \"main\": \"entry.js\" }\n",
      "entry.js": "function root() { return 1; }\nmodule.exports = root;\n",
      "index.js": "function other() { return 2; }\nmodule.exports = other;\n",
      "test/t.js": "const root = require('..');\nroot();\n",
    },
    expectations: [
      { id: "directory-main:resolves-through-main", category: "calls", has: /^test\/t\.js@2:\d+\|module\|root\|RESOLVED\|.*@entry\.js$/ },
    ],
  },
  {
    // Public `this` dispatch: `this.m()` in a class method calls the class's own `m` when the class does not escape its
    // file (an exported class may be extended by its users, F-002), no class extending it defines `m`, nothing
    // replaces `m`, and the calling method is never read as a value (borrowed). The classes in a.js are used, never
    // exported.
    id: "this-dispatch",
    files: {
      "a.js": [
        "class Plain { helper() { return 1; } run() { return this.helper(); } }",
        "class Kept { helper() { return 1; } runKept() { return this.helper(); } } class Child extends Kept { extra() { return 2; } }",
        "class Shadowed { helper() { return 1; } runShadowed() { return this.helper(); } } class Over extends Shadowed { helper() { return 2; } }",
        "class Lent { helper() { return 1; } lend() { return this.helper(); } } setTimeout(new Lent().lend);",
        "class Nested { helper() { return 1; } runNested() { return function () { return this.helper(); }; } }",
        "class Arrow { helper() { return 1; } runArrow() { const f = () => this.helper(); return f(); } }",
        "class Stat { helper() { return 1; } static make() { return this.helper(); } }",
        "new Plain().run(); new Kept().runKept(); new Shadowed().runShadowed(); new Nested().runNested(); new Arrow().runArrow(); new Stat();",
        "",
      ].join("\n"),
      // A class whose superclass cannot be followed may extend any class, so its members may override any method.
      "lone.js": "class Lone { assist() { return 1; } runLone() { return this.assist(); } }\nnew Lone().runLone();\n",
      "mixed.js": "class Mixed extends mix(Object) { assist() { return 2; } }\nmodule.exports = Mixed;\n",
      // Any write of the name in the class's file may replace the method (here, per instance in the constructor).
      "r.js": "class Replaced { constructor() { this.helper = () => 0; } helper() { return 1; } runReplaced() { return this.helper(); } }\nnew Replaced().runReplaced();\n",
      // An exported class stays open: the subclass here overrides, and so might one outside the repository.
      "base.js": "class Base { helper() { return 1; } runBase() { return this.helper(); } }\nmodule.exports = Base;\n",
      "sub.js": "const Base = require('./base');\nclass Sub extends Base { helper() { return 2; } }\nmodule.exports = Sub;\n",
    },
    expectations: [
      { id: "this-dispatch:own-method-resolves", category: "calls", has: /^a\.js@1:\d+\|run\|this\.helper\|RESOLVED\|/ },
      { id: "this-dispatch:subclass-without-override-resolves", category: "calls", has: /^a\.js@2:\d+\|runKept\|this\.helper\|RESOLVED\|/ },
      { id: "this-dispatch:same-file-override-unresolved", category: "calls", has: /^a\.js@3:\d+\|runShadowed\|this\.helper\|UNRESOLVED\|/ },
      { id: "this-dispatch:borrowed-method-unresolved", category: "calls", has: /^a\.js@4:\d+\|lend\|this\.helper\|UNRESOLVED\|/ },
      { id: "this-dispatch:nested-function-unresolved", category: "calls", has: /^a\.js@5:\d+\|[^|]*\|this\.helper\|UNRESOLVED\|/ },
      { id: "this-dispatch:arrow-in-method-resolves", category: "calls", has: /^a\.js@6:\d+\|[^|]*\|this\.helper\|RESOLVED\|/ },
      { id: "this-dispatch:static-to-instance-unresolved", category: "calls", has: /^a\.js@7:\d+\|make\|this\.helper\|UNRESOLVED\|/ },
      { id: "this-dispatch:replaced-in-constructor-unresolved", category: "calls", has: /^r\.js@1:\d+\|runReplaced\|this\.helper\|UNRESOLVED\|/ },
      { id: "this-dispatch:unknown-superclass-may-override", category: "calls", has: /^lone\.js@1:\d+\|runLone\|this\.assist\|UNRESOLVED\|/ },
      { id: "this-dispatch:imported-subclass-overrides", category: "calls", has: /^base\.js@1:\d+\|runBase\|this\.helper\|UNRESOLVED\|/ },
    ],
  },
  {
    // XA-02: an exported subclass lets a package's users override the methods of the internal class it extends.
    // In Node, `class Mine extends Public { helper() { return "mine"; } }` makes `new Mine().run()` return "mine".
    id: "this-dispatch-escaping-subclass",
    files: {
      "lib.js": [
        "class Base { run() { return this.helper(); } helper() { return \"base\"; } }",
        "class Public extends Base {}",
        "class Kept { run() { return this.helper(); } helper() { return \"kept\"; } }",
        "class Inner extends Kept {}",
        "new Inner().run();",
        "module.exports = { Public };",
        "",
      ].join("\n"),
    },
    expectations: [
      { id: "this-dispatch:exported-subclass-keeps-base-open", category: "calls", has: /^lib\.js@1:\d+\|run\|this\.helper\|UNRESOLVED\|/ },
      { id: "this-dispatch:internal-subclass-resolves", category: "calls", has: /^lib\.js@3:\d+\|run\|this\.helper\|RESOLVED\|/ },
    ],
  },
  {
    // XA-03: another file may replace a method on an exported instance. In Node, after app.js runs,
    // `logger.log("hi")` returns "patched hi".
    id: "this-dispatch-instance-write",
    files: {
      "logger.js": [
        "class Logger { log(m) { return this.format(m); } format(m) { return \"[log] \" + m; } }",
        "module.exports = new Logger();",
        "",
      ].join("\n"),
      "app.js": [
        "const logger = require(\"./logger\");",
        "logger.format = function (m) { return \"patched \" + m; };",
        "logger.log(\"hi\");",
        "",
      ].join("\n"),
      "clock.js": [
        "class Clock { now() { return this.tick(); } tick() { return 1; } }",
        "module.exports = new Clock();",
        "",
      ].join("\n"),
    },
    expectations: [
      { id: "this-dispatch:written-in-another-file-unresolved", category: "calls", has: /^logger\.js@1:\d+\|log\|this\.format\|UNRESOLVED\|/ },
      { id: "this-dispatch:never-written-resolves", category: "calls", has: /^clock\.js@1:\d+\|now\|this\.tick\|RESOLVED\|/ },
    ],
  },
  {
    // XA-04: a computed read of an instance takes a method as a value; it then runs with another `this`.
    // In Node, `f.call({ helper() { return "other"; } })` returns "other".
    id: "this-dispatch-computed-borrow",
    files: {
      "a.js": [
        "class C { run() { return this.helper(); } helper() { return \"C\"; } }",
        "const c = new C(); const key = \"run\"; const f = c[key];",
        "f.call({ helper() { return \"other\"; } });",
        "",
      ].join("\n"),
      "self.js": [
        "class S { run() { return this.helper(); } helper() { return 1; } pick(k) { return this[k]; } }",
        "new S().run();",
        "",
      ].join("\n"),
      "proto.js": [
        "class P { run() { return this.helper(); } helper() { return 1; } }",
        "const k = \"run\"; const g = P.prototype[k];",
        "",
      ].join("\n"),
      // Control: a computed read of an unrelated array does not reach the instance (the stated assumption).
      "plain.js": [
        "class Q { run() { return this.helper(); } helper() { return 1; } }",
        "const items = [1, 2]; const i = 0; const first = items[i];",
        "new Q().run();",
        "",
      ].join("\n"),
    },
    expectations: [
      { id: "this-dispatch:instance-computed-read-unresolved", category: "calls", has: /^a\.js@1:\d+\|run\|this\.helper\|UNRESOLVED\|/ },
      { id: "this-dispatch:this-computed-read-unresolved", category: "calls", has: /^self\.js@1:\d+\|run\|this\.helper\|UNRESOLVED\|/ },
      { id: "this-dispatch:prototype-computed-read-unresolved", category: "calls", has: /^proto\.js@1:\d+\|run\|this\.helper\|UNRESOLVED\|/ },
      { id: "this-dispatch:unrelated-computed-read-resolves", category: "calls", has: /^plain\.js@1:\d+\|run\|this\.helper\|RESOLVED\|/ },
    ],
  },
  {
    // XA-05: a call that runs before its CommonJS require binds throws (ReferenceError for const, TypeError for var).
    id: "call-before-require",
    files: {
      "m.js": "exports.a = function a() { return 1; };\n",
      "main.js": [
        "a();",
        "const { a } = require(\"./m\");",
        "function g() { b(); var { a: b } = require(\"./m\"); }",
        "a();",
        "function later() { return a(); }",
        "",
      ].join("\n"),
    },
    expectations: [
      { id: "require-order:module-call-before-unresolved", category: "calls", has: /^main\.js@1:0\|module\|a\|UNRESOLVED\|/ },
      { id: "require-order:function-call-before-unresolved", category: "calls", has: /^main\.js@3:\d+\|g\|b\|UNRESOLVED\|/ },
      { id: "require-order:call-after-resolves", category: "calls", has: /^main\.js@4:0\|module\|a\|RESOLVED\|/ },
      { id: "require-order:nested-function-resolves", category: "calls", has: /^main\.js@5:\d+\|later\|a\|RESOLVED\|/ },
    ],
  },
  {
    // A1: every UNRESOLVED call says why; a RESOLVED call has no reason.
    id: "unresolved-reasons",
    files: {
      "m.js": "exports.ok = function ok() { return 1; };\n",
      "main.js": [
        "const fs = require(\"fs\");",
        "const { missing } = require(\"./gone\");",
        "const { ok } = require(\"./m\");",
        "const handlers = {};",
        "handlers[process.argv[2]]();",
        "early();",
        "const early = () => 1;",
        "fs.readFileSync(\"x\");",
        "undeclaredHelper();",
        "myGlobal.log(\"x\");",
        "missing();",
        "function run(cb) { cb(); }",
        "class K { go() { return this.help(); } help() { return 1; } }",
        "module.exports = K;",
        "let v = ok; v = String; v();",
        "const obj = makeObj(); obj.run();",
        "function h(req, res) { res.json(1); }",
        "obj.a.b();",
        "run(ok);",
        "makeObj().run();",
        "",
      ].join("\n"),
    },
    expectations: [
      // Since ADR-012 B1b, `require` in a CommonJS file is EXTERNAL (commonjs:require); module-load remains for other files.
      { id: "reason:commonjs-require-external", check: (directory) => callReason(directory, 1, "require") === "EXTERNAL" },
      { id: "reason:computed-callee", check: (directory) => callReason(directory, 5, "handlers[<dynamic>]") === "computed-callee" },
      { id: "reason:runs-before-binding", check: (directory) => callReason(directory, 6, "early") === "runs-before-binding" },
      // Since ADR-012 a call through a stable package import is EXTERNAL and has no reason.
      { id: "reason:external-has-none", check: (directory) => callReason(directory, 8, "fs.readFileSync") === "EXTERNAL" },
      { id: "reason:unbound-name", check: (directory) => callReason(directory, 9, "undeclaredHelper") === "unbound-name" },
      { id: "reason:global-member", check: (directory) => callReason(directory, 10, "myGlobal.log") === "global-member" },
      { id: "reason:import-unresolved", check: (directory) => callReason(directory, 11, "missing") === "import-unresolved" },
      { id: "reason:parameter-callee", check: (directory) => callReason(directory, 12, "cb") === "parameter-callee" },
      { id: "reason:this-open", check: (directory) => callReason(directory, 13, "this.help") === "this-open" },
      { id: "reason:local-not-proven", check: (directory) => callReason(directory, 15, "v") === "local-not-proven" },
      { id: "reason:receiver-not-proven", check: (directory) => callReason(directory, 16, "obj.run") === "receiver-not-proven" },
      { id: "reason:parameter-member", check: (directory) => callReason(directory, 17, "res.json") === "parameter-member" },
      { id: "reason:member-chain", check: (directory) => callReason(directory, 18, "obj.a.b") === "member-chain" },
      { id: "reason:call-result-member", check: (directory) => callReason(directory, 20, "makeObj().run") === "call-result-member" },
      { id: "reason:resolved-has-none", check: (directory) => callReason(directory, 19, "run") === "RESOLVED" },
      { id: "reason:every-unresolved-call-has-one", check: (directory) => readJson(directory, "semantic.json").calls.every((call: { resolutionState: string; reason?: string }) => (call.resolutionState === "UNRESOLVED") === (call.reason !== undefined)) },
    ],
  },
  {
    // OR-01, found by the call oracle on Fastify: another file replaces an export, so calls to it are not proven.
    // In Node, after test/t.js runs its first line, reply.send() calls the Stub.
    id: "foreign-export-write",
    files: {
      "lib/hooks.js": "function runHooks() { return \"real\"; }\nfunction other() { return 1; }\nmodule.exports = { runHooks, other };\n",
      "lib/reply.js": "const { runHooks, other } = require(\"./hooks\");\nfunction send() { runHooks(); other(); }\nmodule.exports = { send };\n",
      "lib/patch.js": "const hooks = require(\"./hooks\");\nexports.install = function install() { hooks.runHooks = () => \"patched\"; };\n",
      "test/t.js": "require(\"../lib/hooks\").runHooks = function Stub() { return \"stub\"; };\nrequire(\"../lib/reply\").send();\n",
    },
    expectations: [
      { id: "foreign-export-write:replaced-export-unresolved", category: "calls", has: /^lib\/reply\.js@2:\d+\|send\|runHooks\|UNRESOLVED\|/ },
      { id: "foreign-export-write:untouched-export-resolves", category: "calls", has: /^lib\/reply\.js@2:\d+\|send\|other\|RESOLVED\|/ },
    ],
  },
  {
    // ADR-012, Phase B1c: an alias of a standard global's path, and a built-in method on a literal or `new` value bound
    // once, are EXTERNAL; a rebound binding, a method name the file writes, or a patched prototype keeps it UNRESOLVED.
    id: "external-builtin-values",
    files: {
      "a.js": [
        "var isArray = Array.isArray;",
        "isArray([]);",
        "const out = [];",
        "out.push(1);",
        "const seen = new Map();",
        "seen.get(\"k\");",
        "const name = \"x\";",
        "name.toUpperCase();",
        "let moved = [];",
        "moved = {};",
        "moved.push(2);",
        "",
      ].join("\n"),
      "b.js": "const list = [];\nlist.map = function () {};\nlist.map(String);\n",
      "patch.js": "String.prototype.toUpperCase = function () { return \"patched\"; };\n",
    },
    expectations: [
      { id: "builtin:global-alias", check: (directory) => external(directory, "a.js", 2) === "global:Array.isArray" },
      { id: "builtin:array-literal-method", check: (directory) => external(directory, "a.js", 4) === "global:Array.prototype.push" },
      { id: "builtin:new-map-method", check: (directory) => external(directory, "a.js", 6) === "global:Map.prototype.get" },
      { id: "builtin:patched-prototype-unresolved", category: "calls", has: /^a\.js@8:\d+\|module\|name\.toUpperCase\|UNRESOLVED\|/ },
      { id: "builtin:rebound-binding-unresolved", category: "calls", has: /^a\.js@11:\d+\|module\|moved\.push\|UNRESOLVED\|/ },
      { id: "builtin:own-property-written-not-external", category: "calls", lacks: /^b\.js@3:\d+\|module\|list\.map\|EXTERNAL\|/ },
    ],
  },
  {
    // XB-02 (audit B): `#imports` and a package's self-reference load repository files, as in Node (24): main.js
    // prints "util.f internal.g node tools.t". Controls, which Node rejects with MODULE_NOT_FOUND: sub/ has its own
    // package.json without `imports` (the nearest manifest decides), and noexp has no `exports`, so it cannot name itself.
    id: "package-imports",
    files: {
      "package.json": "{ \"name\": \"selfpkg\", \"exports\": { \".\": \"./src/index.js\", \"./tools\": \"./src/tools.js\" }, \"imports\": { \"#util\": \"./src/util.js\", \"#internal/*\": \"./src/internal/*.js\", \"#cond\": { \"node\": \"./src/cond-node.js\", \"default\": \"./src/cond-default.js\" } } }\n",
      "src/util.js": "exports.f = () => \"util.f\";\n",
      "src/internal/deep.js": "exports.g = () => \"internal.g\";\n",
      "src/cond-node.js": "exports.c = () => \"node\";\n",
      "src/cond-default.js": "exports.c = () => \"default\";\n",
      "src/tools.js": "exports.t = () => \"tools.t\";\n",
      "src/index.js": "exports.i = () => \"index.i\";\n",
      "main.js": [
        "const util = require(\"#util\");",
        "const deep = require(\"#internal/deep\");",
        "const cond = require(\"#cond\");",
        "const tools = require(\"selfpkg/tools\");",
        "console.log(util.f(), deep.g(), cond.c(), tools.t());",
        "",
      ].join("\n"),
      "sub/package.json": "{ \"name\": \"inner\" }\n",
      "sub/a.js": "let r;\ntry { const u = require(\"#util\"); r = u.f(); } catch (e) { r = e.code; }\nconsole.log(\"sub:\", r);\n",
      "noexp/package.json": "{ \"name\": \"noexp\" }\n",
      "noexp/x.js": "exports.x = () => \"x\";\n",
      "noexp/use.js": "let r;\ntry { const n = require(\"noexp/x\"); r = n.x(); } catch (e) { r = e.code; }\nconsole.log(\"noexp:\", r);\n",
    },
    expectations: [
      { id: "xb02:hash-import", category: "calls", has: /^main\.js@5:\d+\|module\|util\.f\|RESOLVED\|export:f@1:0@src\/util\.js$/ },
      { id: "xb02:hash-import-wildcard", category: "calls", has: /^main\.js@5:\d+\|module\|deep\.g\|RESOLVED\|export:g@1:0@src\/internal\/deep\.js$/ },
      { id: "xb02:hash-import-condition", category: "calls", has: /^main\.js@5:\d+\|module\|cond\.c\|RESOLVED\|export:c@1:0@src\/cond-node\.js$/ },
      { id: "xb02:self-reference", category: "calls", has: /^main\.js@5:\d+\|module\|tools\.t\|RESOLVED\|export:t@1:0@src\/tools\.js$/ },
      { id: "xb02:hash-import-edge", category: "module-edges", has: /^main\.js -> src\/util\.js\|#util\|/ },
      { id: "xb02:nearest-manifest-without-imports", category: "calls", has: /^sub\/a\.js@2:\d+\|module\|u\.f\|UNRESOLVED\|/ },
      { id: "xb02:self-reference-needs-exports", category: "calls", has: /^noexp\/use\.js@2:\d+\|module\|n\.x\|UNRESOLVED\|/ },
    ],
  },
  {
    // ADR-012, Phase B1b: a call on an unbound standard global is EXTERNAL unless some file writes that path; a test
    // runner's globals stay UNRESOLVED; `require` is EXTERNAL only in CommonJS.
    id: "external-globals",
    files: {
      "a.js": [
        "const fs = require(\"fs\");",
        "Object.keys({});",
        "process.nextTick(() => {});",
        "setTimeout(() => {}, 1);",
        "console.log(\"x\");",
        "process.stdout.write(\"y\");",
        "describe(\"suite\", () => {});",
        "",
      ].join("\n"),
      "patch.js": "process.stdout.write = function () {};\nconsole[\"log\"] = () => {};\n",
      "e.mjs": "import fs from \"fs\";\nrequire(\"x\");\nMath.max(1, 2);\n",
    },
    expectations: [
      { id: "global:commonjs-require", check: (directory) => external(directory, "a.js", 1) === "commonjs:require" },
      { id: "global:object-member", check: (directory) => external(directory, "a.js", 2) === "global:Object.keys" },
      { id: "global:process-member", check: (directory) => external(directory, "a.js", 3) === "global:process.nextTick" },
      { id: "global:function", check: (directory) => external(directory, "a.js", 4) === "global:setTimeout" },
      { id: "global:esm-member", check: (directory) => external(directory, "e.mjs", 3) === "global:Math.max" },
      { id: "global:written-member-unresolved", category: "calls", has: /^a\.js@5:\d+\|module\|console\.log\|UNRESOLVED\|/ },
      { id: "global:written-path-unresolved", category: "calls", has: /^a\.js@6:\d+\|module\|process\.stdout\.write\|UNRESOLVED\|/ },
      { id: "global:test-runner-unresolved", category: "calls", has: /^a\.js@7:\d+\|module\|describe\|UNRESOLVED\|/ },
      { id: "global:esm-require-unresolved", category: "calls", has: /^e\.mjs@2:\d+\|module\|require\|UNRESOLVED\|/ },
    ],
  },
  {
    // Phase B2: a TypeScript file with `import` syntax that the compiler turns into CommonJS still has the wrapper's
    // `require`. The nearest tsconfig.json decides: `module` commonjs, or a Node setting outside a `"type": "module"`
    // package (`.cts` always), looked up through relative `extends` only.
    id: "compiled-commonjs",
    files: {
      "cjs/tsconfig.json": "{\n  // tsc --init\n  \"compilerOptions\": { \"module\": \"CommonJS\", },\n}\n",
      "cjs/a.ts": "import fs from \"fs\";\nrequire(\"x\");\n",
      "cjs/sub/b.ts": "import fs from \"fs\";\nrequire(\"x\");\n",
      "cjs/c.mts": "import fs from \"fs\";\nrequire(\"x\");\n",
      "cjs/d.js": "import fs from \"fs\";\nrequire(\"x\");\n",
      "esm/tsconfig.json": "{ \"compilerOptions\": { \"module\": \"ESNext\" } }\n",
      "esm/a.ts": "import fs from \"fs\";\nrequire(\"x\");\n",
      "ext/tsconfig.json": "{ \"extends\": \"../cjs/tsconfig.json\", \"compilerOptions\": { \"strict\": true } }\n",
      "ext/a.ts": "import fs from \"fs\";\nrequire(\"x\");\n",
      "pkgext/tsconfig.json": "{ \"extends\": \"@scope/tsconfig\" }\n",
      "pkgext/a.ts": "import fs from \"fs\";\nrequire(\"x\");\n",
      "node/tsconfig.json": "{ \"compilerOptions\": { \"module\": \"NodeNext\" } }\n",
      "node/package.json": "{ \"type\": \"module\" }\n",
      "node/a.ts": "import fs from \"fs\";\nrequire(\"x\");\n",
      "node/b.cts": "import fs from \"fs\";\nrequire(\"x\");\n",
      "node/cjs/package.json": "{ \"type\": \"commonjs\" }\n",
      "node/cjs/a.ts": "import fs from \"fs\";\nrequire(\"x\");\n",
    },
    expectations: [
      { id: "cjs-ts:module-commonjs", check: (directory) => external(directory, "cjs/a.ts", 2) === "commonjs:require" },
      { id: "cjs-ts:nearest-config-above", check: (directory) => external(directory, "cjs/sub/b.ts", 2) === "commonjs:require" },
      { id: "cjs-ts:relative-extends", check: (directory) => external(directory, "ext/a.ts", 2) === "commonjs:require" },
      { id: "cjs-ts:nodenext-cts", check: (directory) => external(directory, "node/b.cts", 2) === "commonjs:require" },
      { id: "cjs-ts:nodenext-commonjs-package", check: (directory) => external(directory, "node/cjs/a.ts", 2) === "commonjs:require" },
      { id: "cjs-ts:mts-unresolved", category: "calls", has: /^cjs\/c\.mts@2:\d+\|module\|require\|UNRESOLVED\|/ },
      { id: "cjs-ts:javascript-unresolved", category: "calls", has: /^cjs\/d\.js@2:\d+\|module\|require\|UNRESOLVED\|/ },
      { id: "cjs-ts:esnext-unresolved", category: "calls", has: /^esm\/a\.ts@2:\d+\|module\|require\|UNRESOLVED\|/ },
      { id: "cjs-ts:package-extends-unresolved", category: "calls", has: /^pkgext\/a\.ts@2:\d+\|module\|require\|UNRESOLVED\|/ },
      { id: "cjs-ts:nodenext-module-package-unresolved", category: "calls", has: /^node\/a\.ts@2:\d+\|module\|require\|UNRESOLVED\|/ },
    ],
  },
  {
    // XB-01 (audit B): a function assigned as an export carries its parameters to the sink, whether it is
    // `exports.f = function …`, `module.exports.f = (…) => …` or `module.exports = function …`. In Node each route
    // passes the query value to execSync; `safe` ignores its argument.
    id: "export-function-summaries",
    files: {
      "lib.js": "const cp = require(\"child_process\");\nexports.run = function (cmd) { return cp.execSync(cmd); };\nexports.safe = function (cmd) { return cp.execSync(\"ls\"); };\n",
      "mod.js": "const cp = require(\"child_process\");\nmodule.exports.go = (cmd) => cp.execSync(cmd);\n",
      "def.js": "const cp = require(\"child_process\");\nmodule.exports = function (cmd) { return cp.execSync(cmd); };\n",
      "app.js": [
        "const express = require(\"express\");",
        "const lib = require(\"./lib\");",
        "const mod = require(\"./mod\");",
        "const def = require(\"./def\");",
        "const app = express();",
        "app.get(\"/a\", (req, res) => { lib.run(req.query.a); res.end(); });",
        "app.get(\"/b\", (req, res) => { mod.go(req.query.b); res.end(); });",
        "app.get(\"/c\", (req, res) => { def(req.query.c); res.end(); });",
        "app.get(\"/d\", (req, res) => { lib.safe(req.query.d); res.end(); });",
        "",
      ].join("\n"),
    },
    expectations: [
      { id: "xb01:exports-function-expression", category: "taint", has: /^lib\.js\|.*via=\[cmd:parameter@lib\.js\]\|sink=#[0-9a-z]+:child_process\.execSync\|/ },
      { id: "xb01:module-exports-member-arrow", category: "taint", has: /^mod\.js\|.*sink=#[0-9a-z]+:child_process\.execSync\|/ },
      { id: "xb01:module-exports-default-function", category: "taint", has: /^def\.js\|.*sink=#[0-9a-z]+:child_process\.execSync\|/ },
      { id: "xb01:ignored-argument-no-flow", check: (directory) => taintKeys(directory).some((key) => key.includes("source:req.query.a@")) && !taintKeys(directory).some((key) => key.includes("source:req.query.d@")) },
    ],
  },
  {
    // Phase C1: a method of the object literal a repository factory returns. In Node, `app.get("/x")` returns "get /x" and
    // `app.ready()` returns "patched ready" (the factory's own file replaces it).
    id: "factory-objects",
    files: {
      "app.js": [
        "const kState = Symbol(\"state\");",
        "function inject() { return \"inject\"; }",
        "function create(options) {",
        "  const app = {",
        "    [kState]: {},",
        "    get: function _get(path) { return \"get \" + path; },",
        "    listen() { return \"listen\"; },",
        "    inject: inject,",
        "    ready: function () { return \"ready\"; },",
        "    get prefix() { return \"/\"; },",
        "  };",
        "  app.ready = function () { return \"patched ready\"; };",
        "  return app;",
        "}",
        "module.exports = create;",
        "",
      ].join("\n"),
      "test/t.js": [
        "const create = require(\"../app\");",
        "const app = create();",
        "app.get(\"/x\");",
        "app.listen();",
        "app.inject();",
        "app.ready();",
        "let other = create();",
        "other = {};",
        "other.get(\"/y\");",
        "",
      ].join("\n"),
      "plugin.js": "module.exports = function plugin(instance) { instance.listen = () => \"replaced\"; };\n",
    },
    expectations: [
      { id: "factory:function-property-resolves", category: "calls", has: /^test\/t\.js@3:\d+\|module\|app\.get\|RESOLVED\|variable:get@6:4@app\.js/ },
      { id: "factory:shorthand-function-resolves", category: "calls", has: /^test\/t\.js@5:\d+\|module\|app\.inject\|RESOLVED\|function:inject@2:0@app\.js/ },
      { id: "factory:written-elsewhere-unresolved", category: "calls", has: /^test\/t\.js@4:\d+\|module\|app\.listen\|UNRESOLVED\|/ },
      { id: "factory:written-in-factory-file-unresolved", category: "calls", has: /^test\/t\.js@6:\d+\|module\|app\.ready\|UNRESOLVED\|/ },
      { id: "factory:rebound-binding-unresolved", category: "calls", has: /^test\/t\.js@9:\d+\|module\|other\.get\|UNRESOLVED\|/ },
    ],
  },
  {
    // XB-04 (audit B): the factory's returned name must be its one top-level binding, never rebound. In Node:
    // block() returns the module `o` ("module-o"), swap() the argument ("swapped"), caught() the thrown value,
    // looped() the last array element; nested() returns its own literal ("nested") from inside a block.
    id: "factory-bindings",
    files: {
      "a.js": [
        "const o = { run() { return \"module-o\"; } };",
        "function block() { if (true) { const o = { run() { return \"block-o\"; } }; void o; } return o; }",
        "function swap(other) { let o = { run() { return \"literal\"; } }; [o] = [other]; return o; }",
        "function caught() { const o = { run() { return \"literal\"; } }; try { throw { run() { return \"thrown\"; } }; } catch (o) { return o; } }",
        "function looped(xs) { let o = { run() { return \"literal\"; } }; for (o of xs) {} return o; }",
        "function nested() { const p = { run() { return \"nested\"; } }; if (true) { return p; } return p; }",
        "const b = block(); const s = swap({ run() { return \"swapped\"; } }); const c = caught(); const l = looped([{ run() { return \"last\"; } }]); const n = nested();",
        "b.run(); s.run(); c.run(); l.run(); n.run();",
        "",
      ].join("\n"),
    },
    expectations: [
      { id: "xb04:block-shadow-unresolved", category: "calls", has: /^a\.js@8:\d+\|module\|b\.run\|UNRESOLVED\|/ },
      { id: "xb04:destructuring-swap-unresolved", category: "calls", has: /^a\.js@8:\d+\|module\|s\.run\|UNRESOLVED\|/ },
      { id: "xb04:catch-shadow-unresolved", category: "calls", has: /^a\.js@8:\d+\|module\|c\.run\|UNRESOLVED\|/ },
      { id: "xb04:for-of-rebind-unresolved", category: "calls", has: /^a\.js@8:\d+\|module\|l\.run\|UNRESOLVED\|/ },
      { id: "xb04:return-in-block-resolves", category: "calls", has: /^a\.js@8:\d+\|module\|n\.run\|RESOLVED\|variable:run@6:\d+@a\.js/ },
    ],
  },
  {
    // Phase C2: an instance of a constructor function reaches the method its prototype is given by name, and
    // `Object.create(P)` reaches P's method. Each control breaks one condition: the constructor returns an object,
    // inherits (passed to a call), has its prototype replaced, the instance gets its own method, another file writes the
    // name, `Object.create` takes property descriptors.
    id: "prototype-objects",
    files: {
      "view.js": [
        "function View(name) { this.name = name; }",
        "View.prototype.render = function render() { return \"render \" + this.name; };",
        "View.prototype.lookup = function lookup() { return \"lookup\"; };",
        "module.exports = View;",
        "",
      ].join("\n"),
      "app.js": [
        "const View = require(\"./view\");",
        "const view = new View(\"home\");",
        "view.render();",
        "view.lookup();",
        "function Odd() { return { render() { return \"other\"; } }; }",
        "Odd.prototype.go = function go() { return \"go\"; };",
        "const odd = new Odd();",
        "odd.go();",
        "function Child() {}",
        "Child.prototype.walk = function walk() { return \"walk\"; };",
        "inherit(Child);",
        "const child = new Child();",
        "child.walk();",
        "function Swapped() {}",
        "Swapped.prototype.run = function run() { return \"run\"; };",
        "Swapped.prototype = {};",
        "const swapped = new Swapped();",
        "swapped.run();",
        "function Own() {}",
        "Own.prototype.jump = function jump() { return \"jump\"; };",
        "const own = new Own();",
        "own.jump = function () { return \"own\"; };",
        "own.jump();",
        "const base = {};",
        "base.greet = function greet() { return \"hi\"; };",
        "const made = Object.create(base);",
        "made.greet();",
        "base.wave = function wave() { return \"wave\"; };",
        "const described = Object.create(base, {});",
        "described.wave();",
        "function inherit(constructor) { return constructor; }",
        "",
      ].join("\n"),
      "plugin.js": "module.exports = function plugin(instance) { instance.lookup = () => \"replaced\"; };\n",
      // A parameter named like the constructor gets a prototype method; a computed key may write any name.
      "shadow.js": [
        "function Tool() {}",
        "Tool.prototype.cut = function cut() { return \"cut\"; };",
        "function build(Tool) { Tool.prototype.saw = function saw() { return \"saw\"; }; return Tool; }",
        "const tool = new Tool();",
        "tool.saw();",
        "function Mixed() {}",
        "Mixed.prototype.mix = function mix() { return \"mix\"; };",
        "Mixed.prototype[\"m\" + \"ix\"] = function () { return \"other\"; };",
        "const mixed = new Mixed();",
        "mixed.mix();",
        "",
      ].join("\n"),
    },
    expectations: [
      { id: "prototype:shadowed-constructor-name-unresolved", category: "calls", has: /^shadow\.js@5:\d+\|module\|tool\.saw\|UNRESOLVED\|/ },
      { id: "prototype:computed-prototype-write-unresolved", category: "calls", has: /^shadow\.js@10:\d+\|module\|mixed\.mix\|UNRESOLVED\|/ },
      { id: "prototype:constructed-instance-resolves", category: "calls", has: /^app\.js@3:\d+\|module\|view\.render\|RESOLVED\|method:render@2:\d+@view\.js/ },
      { id: "prototype:written-elsewhere-unresolved", category: "calls", has: /^app\.js@4:\d+\|module\|view\.lookup\|UNRESOLVED\|/ },
      { id: "prototype:constructor-returns-value-unresolved", category: "calls", has: /^app\.js@8:\d+\|module\|odd\.go\|UNRESOLVED\|/ },
      { id: "prototype:constructor-passed-to-call-unresolved", category: "calls", has: /^app\.js@13:\d+\|module\|child\.walk\|UNRESOLVED\|/ },
      { id: "prototype:replaced-prototype-unresolved", category: "calls", has: /^app\.js@18:\d+\|module\|swapped\.run\|UNRESOLVED\|/ },
      { id: "prototype:own-property-unresolved", category: "calls", has: /^app\.js@23:\d+\|module\|own\.jump\|UNRESOLVED\|/ },
      { id: "prototype:object-create-resolves", category: "calls", has: /^app\.js@27:\d+\|module\|made\.greet\|RESOLVED\|method:greet@25:\d+@app\.js/ },
      { id: "prototype:object-create-descriptors-unresolved", category: "calls", has: /^app\.js@30:\d+\|module\|described\.wave\|UNRESOLVED\|/ },
    ],
  },
  {
    // Phase C2b: a constructor that inherits, through `Object.create(X.prototype)`, `util.inherits` or
    // `Object.setPrototypeOf`, still reaches its own prototype's methods when the link comes first and the parent cannot
    // give the instance an own method unseen (a package, a standard error, a constructor of this file).
    id: "prototype-inheritance",
    files: {
      "schema.js": [
        "const EventEmitter = require(\"events\").EventEmitter;",
        "const util = require(\"util\");",
        "const Base = require(\"./base\");",
        "function Schema() { EventEmitter.call(this); }",
        "Schema.prototype = Object.create(EventEmitter.prototype);",
        "Schema.prototype.constructor = Schema;",
        "Object.defineProperty(Schema.prototype, \"$kind\", { value: 1 });",
        "Schema.prototype.add = function add() { return this; };",
        "function Pipe() {}",
        "util.inherits(Pipe, Base);",
        "Pipe.prototype.flow = function flow() { return \"flow\"; };",
        "function Late() {}",
        "Late.prototype.tick = function tick() { return \"tick\"; };",
        "Object.setPrototypeOf(Late.prototype, EventEmitter.prototype);",
        "function Fail() {}",
        "Fail.prototype = Object.create(Error.prototype);",
        "const early = new Fail();",
        "early.explain();",
        "Fail.prototype.explain = function explain() { return \"why\"; };",
        "function Parent() { this.speak = function () { return \"own\"; }; }",
        "function Kid() { Parent.call(this); }",
        "Kid.prototype = Object.create(Parent.prototype);",
        "Kid.prototype.speak = function speak() { return \"proto\"; };",
        "Kid.prototype.play = function play() { return \"play\"; };",
        "const schema = new Schema();",
        "schema.add();",
        "const pipe = new Pipe();",
        "pipe.flow();",
        "const late = new Late();",
        "late.tick();",
        "function later() { return early.explain(); }",
        "const kid = new Kid();",
        "kid.speak();",
        "kid.play();",
        "",
      ].join("\n"),
      "base.js": "function Base() { this.flow = function () { return \"own\"; }; }\nmodule.exports = Base;\n",
      "statics.js": [
        "function Model() { if (!(this instanceof Model)) return new Model(); }",
        "Model.prototype.save = function save() { return \"saved\"; };",
        "Object.defineProperty(Model, \"kinds\", { value: [] });",
        "const model = new Model();",
        "model.save();",
        "",
      ].join("\n"),
      "own.js": [
        "function Doc() {}",
        "Doc.prototype.load = function load() { return \"loaded\"; };",
        "const doc = new Doc();",
        "function patch(target) { Object.defineProperty(target, \"load\", { value: () => \"own\" }); }",
        "doc.load();",
        "",
      ].join("\n"),
    },
    expectations: [
      { id: "inherit:static-define-property-resolves", category: "calls", has: /^statics\.js@5:\d+\|module\|model\.save\|RESOLVED\|method:save@2:\d+@statics\.js/ },
      { id: "inherit:instance-define-property-unresolved", category: "calls", has: /^own\.js@5:\d+\|module\|doc\.load\|UNRESOLVED\|/ },
      { id: "inherit:object-create-package-parent-resolves", category: "calls", has: /^schema\.js@26:\d+\|module\|schema\.add\|RESOLVED\|method:add@8:\d+@schema\.js/ },
      { id: "inherit:repository-parent-in-other-file-unresolved", category: "calls", has: /^schema\.js@28:\d+\|module\|pipe\.flow\|UNRESOLVED\|/ },
      { id: "inherit:link-after-method-unresolved", category: "calls", has: /^schema\.js@30:\d+\|module\|late\.tick\|UNRESOLVED\|/ },
      { id: "inherit:top-level-call-before-ready-unresolved", category: "calls", has: /^schema\.js@18:\d+\|module\|early\.explain\|UNRESOLVED\|/ },
      { id: "inherit:call-in-function-resolves", category: "calls", has: /^schema\.js@31:\d+\|later\|early\.explain\|RESOLVED\|method:explain@19:\d+@schema\.js/ },
      { id: "inherit:parent-writes-name-unresolved", category: "calls", has: /^schema\.js@33:\d+\|module\|kid\.speak\|UNRESOLVED\|/ },
      { id: "inherit:local-parent-resolves", category: "calls", has: /^schema\.js@34:\d+\|module\|kid\.play\|RESOLVED\|method:play@24:\d+@schema\.js/ },
    ],
  },
  {
    // Phase C3a: `require("./m").name()` when m builds its exports object plainly: one `module.exports = { … }`
    // literal, or an alias it fills (`var app = exports = module.exports = {}`). Each control breaks one condition.
    id: "export-objects",
    files: {
      "lit.js": [
        "function helper() { return \"h\"; }",
        "module.exports = {",
        "  helper: helper,",
        "  run: function run() { return \"r\"; },",
        "  get size() { return 1; },",
        "  twice: function first() { return 1; },",
        "  twice: function second() { return 2; },",
        "};",
        "",
      ].join("\n"),
      "spread.js": "const extra = { go() { return \"other\"; } };\nmodule.exports = { go: function go() { return \"go\"; }, ...extra };\n",
      "alias.js": [
        "var app = exports = module.exports = {};",
        "app.use = function use() { return \"use\"; };",
        "app.set = function set() { return 1; };",
        "app.set = function setAgain() { return 2; };",
        "",
      ].join("\n"),
      "direct.js": "const api = module.exports;\napi.ping = function ping() { return \"pong\"; };\n",
      "passed.js": "var api = module.exports = {};\napi.beep = function beep() { return 1; };\nObject.assign(api, { beep() { return 2; } });\n",
      "replaced.js": "module.exports = { start: function start() { return 1; } };\nif (process.env.X) module.exports = {};\n",
      "patched.js": "module.exports = { stop: function stop() { return 1; } };\n",
      "use.js": [
        "const lit = require(\"./lit\");",
        "const spread = require(\"./spread\");",
        "const alias = require(\"./alias\");",
        "const direct = require(\"./direct\");",
        "const passed = require(\"./passed\");",
        "const replaced = require(\"./replaced\");",
        "const patched = require(\"./patched\");",
        "lit.helper(); lit.run(); lit.size(); lit.twice();",
        "spread.go();",
        "alias.use(); alias.set();",
        "direct.ping();",
        "passed.beep();",
        "replaced.start();",
        "patched.stop();",
        "const target = require(\"./target\");",
        "target.go(); target.leave(); target.stay(); target.swap();",
        "",
      ].join("\n"),
      "plugin.js": "const patched = require(\"./patched\");\npatched.stop = () => \"patched\";\n",
      // A file writing names on its own fresh exports object does not block them elsewhere; one whose "alias" is
      // another module's object, or a nested parameter of the alias's name, does.
      "target.js": "var api = module.exports = {};\napi.go = function go() { return 1; };\napi.leave = function leave() { return 2; };\napi.stay = function stay() { return 3; };\napi.swap = function swap() { return 4; };\n",
      "writer-fresh.js": "var proto = module.exports = function () {};\nproto.go = function go() { return \"router\"; };\n",
      "writer-required.js": "var other = module.exports = require(\"./target\");\nother.leave = function leave() { return \"patched\"; };\n",
      "writer-nested.js": "var p = module.exports = {};\nfunction patch(p) { p.stay = function stay() { return \"patched\"; }; }\nmodule.exports.patch = patch;\n",
      "writer-read.js": "module.exports = require(\"./target\");\nconst api = module.exports;\napi.swap = function swap() { return \"patched\"; };\n",
    },
    expectations: [
      { id: "export:own-fresh-alias-write-does-not-block", category: "calls", has: /^use\.js@16:\d+\|module\|target\.go\|RESOLVED\|method:go@2:\d+@target\.js/ },
      { id: "export:alias-of-other-module-blocks", category: "calls", has: /^use\.js@16:\d+\|module\|target\.leave\|UNRESOLVED\|/ },
      { id: "export:nested-parameter-write-blocks", category: "calls", has: /^use\.js@16:\d+\|module\|target\.stay\|UNRESOLVED\|/ },
      { id: "export:read-alias-of-required-exports-blocks", category: "calls", has: /^use\.js@16:\d+\|module\|target\.swap\|UNRESOLVED\|/ },      { id: "export:literal-function-binding-resolves", category: "calls", has: /^use\.js@8:\d+\|module\|lit\.helper\|RESOLVED\|/ },
      { id: "export:literal-function-expression-resolves", category: "calls", has: /^use\.js@8:\d+\|module\|lit\.run\|RESOLVED\|/ },
      { id: "export:literal-getter-unresolved", category: "calls", has: /^use\.js@8:\d+\|module\|lit\.size\|UNRESOLVED\|/ },
      { id: "export:literal-duplicate-key-unresolved", category: "calls", has: /^use\.js@8:\d+\|module\|lit\.twice\|UNRESOLVED\|/ },
      { id: "export:literal-spread-unresolved", category: "calls", has: /^use\.js@9:\d+\|module\|spread\.go\|UNRESOLVED\|/ },
      { id: "export:alias-resolves", category: "calls", has: /^use\.js@10:\d+\|module\|alias\.use\|RESOLVED\|method:use@2:\d+@alias\.js/ },
      { id: "export:alias-written-twice-unresolved", category: "calls", has: /^use\.js@10:\d+\|module\|alias\.set\|UNRESOLVED\|/ },
      { id: "export:direct-alias-resolves", category: "calls", has: /^use\.js@11:\d+\|module\|direct\.ping\|RESOLVED\|method:ping@2:\d+@direct\.js/ },
      { id: "export:alias-passed-to-call-unresolved", category: "calls", has: /^use\.js@12:\d+\|module\|passed\.beep\|UNRESOLVED\|/ },
      { id: "export:exports-replaced-twice-unresolved", category: "calls", has: /^use\.js@13:\d+\|module\|replaced\.start\|UNRESOLVED\|/ },
      { id: "export:written-in-other-file-unresolved", category: "calls", has: /^use\.js@14:\d+\|module\|patched\.stop\|UNRESOLVED\|/ },
    ],
  },
  {
    // Phase C3b: a factory copies properties onto the object it returns (`merge-descriptors`, `Object.assign`), as
    // Express's createApplication does. The copies are replayed in order: without overwrite the first source to hold a
    // name keeps it, with overwrite the last does. A source with unknown names, a copy in a branch, or a name the
    // factory's file writes leaves the call unresolved.
    id: "factory-copies",
    files: {
      "lib/application.js": [
        "var app = exports = module.exports = {};",
        "app.init = function init() { return \"init\"; };",
        "app.use = function use() { return \"use\"; };",
        "app.on = function on() { return \"app on\"; };",
        "",
      ].join("\n"),
      "lib/express.js": [
        "var EventEmitter = require(\"events\").EventEmitter;",
        "var mixin = require(\"merge-descriptors\");",
        "var proto = require(\"./application\");",
        "var local = { use: function () { return \"local\"; } };",
        "function keepFirst() { var a = function () {}; mixin(a, EventEmitter.prototype, false); mixin(a, proto, false); return a; }",
        "function overwrite() { var b = function () {}; mixin(b, EventEmitter.prototype, false); mixin(b, proto); return b; }",
        "function unknownSource() { var c = function () {}; mixin(c, local, false); return c; }",
        "function conditional(flag) { var d = function () {}; mixin(d, EventEmitter.prototype, false); if (flag) mixin(d, proto); return d; }",
        "function assigned() { var e = {}; Object.assign(e, EventEmitter.prototype, proto); return e; }",
        "module.exports = { keepFirst: keepFirst, overwrite: overwrite, unknownSource: unknownSource, conditional: conditional, assigned: assigned };",
        "",
      ].join("\n"),
      "lib/writes.js": [
        "var mixin = require(\"merge-descriptors\");",
        "var proto = require(\"./application\");",
        "function writesName() { var f = function () {}; mixin(f, proto, false); f.init = function () { return \"own\"; }; return f; }",
        "module.exports = { writesName: writesName };",
        "",
      ].join("\n"),
      "test.js": [
        "const x = require(\"./lib/express\");",
        "const w = require(\"./lib/writes\");",
        "const a = x.keepFirst();",
        "a.use();",
        "a.on();",
        "const b = x.overwrite();",
        "b.on();",
        "const c = x.unknownSource();",
        "c.use();",
        "const d = x.conditional(true);",
        "d.on();",
        "const e = x.assigned();",
        "e.on();",
        "e.emit();",
        "const f = w.writesName();",
        "f.init();",
        "f.use();",
        "const make = require(\"./index\");",
        "const viaIndex = make();",
        "viaIndex.use();",
        "const makeTwice = require(\"./twice\");",
        "const viaTwice = makeTwice();",
        "viaTwice.use();",
        "",
      ].join("\n"),
      // A package entry that re-exports the factory module, as Express's index.js does; and one that may replace it.
      "lib/single.js": [
        "var mixin = require(\"merge-descriptors\");",
        "var proto = require(\"./application\");",
        "function create() { var g = function () {}; mixin(g, proto, false); return g; }",
        "module.exports = create;",
        "",
      ].join("\n"),
      "index.js": "module.exports = require(\"./lib/single\");\n",
      "twice.js": "module.exports = require(\"./lib/single\");\nif (process.env.X) module.exports = function () { return {}; };\n",
    },
    expectations: [
      { id: "copies:through-default-reexport-resolves", category: "calls", has: /^test\.js@20:\d+\|module\|viaIndex\.use\|RESOLVED\|method:use@3:\d+@lib\/application\.js/ },
      { id: "copies:reexport-written-twice-unresolved", category: "calls", has: /^test\.js@23:\d+\|module\|viaTwice\.use\|UNRESOLVED\|/ },
      { id: "copies:module-member-resolves", category: "calls", has: /^test\.js@4:\d+\|module\|a\.use\|RESOLVED\|method:use@3:\d+@lib\/application\.js/ },
      { id: "copies:first-source-kept-without-overwrite", check: (directory) => external(directory, "test.js", 5) === "events:EventEmitter.prototype.on" },
      { id: "copies:later-source-wins-with-overwrite", category: "calls", has: /^test\.js@7:\d+\|module\|b\.on\|RESOLVED\|method:on@4:\d+@lib\/application\.js/ },
      { id: "copies:unknown-source-unresolved", category: "calls", has: /^test\.js@9:\d+\|module\|c\.use\|UNRESOLVED\|/ },
      { id: "copies:copy-in-branch-unresolved", category: "calls", has: /^test\.js@11:\d+\|module\|d\.on\|UNRESOLVED\|/ },
      { id: "copies:object-assign-last-wins", category: "calls", has: /^test\.js@13:\d+\|module\|e\.on\|RESOLVED\|method:on@4:\d+@lib\/application\.js/ },
      { id: "copies:object-assign-builtin-external", check: (directory) => external(directory, "test.js", 14) === "events:EventEmitter.prototype.emit" },
      { id: "copies:name-written-by-factory-file-unresolved", category: "calls", has: /^test\.js@16:\d+\|module\|f\.init\|UNRESOLVED\|/ },
      { id: "copies:other-names-still-resolve", category: "calls", has: /^test\.js@17:\d+\|module\|f\.use\|RESOLVED\|method:use@3:\d+@lib\/application\.js/ },
    ],
  },
  {
    // ADR-012, Phase B1: a call through a stable import of a package or Node module is EXTERNAL; a rebound import,
    // a package member another file replaces, or a shadowing parameter keeps it UNRESOLVED.
    id: "external-imports",
    files: {
      "a.js": [
        "const fs = require(\"fs\");",
        "const { exec } = require(\"child_process\");",
        "const { promises } = require(\"fs\");",
        "let lodash = require(\"lodash\");",
        "const path = require(\"path\");",
        "fs.readFileSync(\"x\");",
        "exec(\"ls\");",
        "promises.readFile(\"y\");",
        "lodash.map([], String);",
        "lodash = { map() {} };",
        "path.join(\"a\", \"b\");",
        "function local(fs) { return fs.readFileSync(\"z\"); }",
        "",
      ].join("\n"),
      "patch.js": "require(\"path\").join = function () { return \"patched\"; };\n",
      "b.mjs": "import * as os from \"os\";\nos.cpus();\n",
    },
    expectations: [
      { id: "external:module-member", check: (directory) => external(directory, "a.js", 6) === "fs:readFileSync" },
      { id: "external:named-import", check: (directory) => external(directory, "a.js", 7) === "child_process:exec" },
      { id: "external:member-chain", check: (directory) => external(directory, "a.js", 8) === "fs:promises.readFile" },
      { id: "external:namespace-import", check: (directory) => external(directory, "b.mjs", 2) === "os:cpus" },
      { id: "external:rebound-import-unresolved", category: "calls", has: /^a\.js@9:\d+\|module\|lodash\.map\|UNRESOLVED\|/ },
      { id: "external:patched-member-unresolved", category: "calls", has: /^a\.js@11:\d+\|module\|path\.join\|UNRESOLVED\|/ },
      { id: "external:shadowing-parameter-unresolved", category: "calls", has: /^a\.js@12:\d+\|local\|fs\.readFileSync\|UNRESOLVED\|/ },
      { id: "external:no-reason-or-target", check: (directory) => readJson(directory, "semantic.json").calls.filter((call: { resolutionState: string }) => call.resolutionState === "EXTERNAL")
        .every((call: { reason?: string; targetSymbolId?: string; external?: unknown }) => call.reason === undefined && call.targetSymbolId === undefined && call.external !== undefined) },
    ],
  },
  {
    // 2026-11-08 audit probe T16: string-built SQL through a client instance is SQL injection.
    id: "taint-sql-client",
    files: {
      "db.js": "const mysql = require(\"mysql\");\nconst conn = mysql.createConnection({});\nexports.find = function find(req, res) { conn.query(\"SELECT * FROM users WHERE id = \" + req.query.id, () => {}); };\n",
      "pg.js": "import { Pool } from \"pg\";\nconst pool = new Pool();\nexport async function list(req, res) { return pool.query(\"SELECT * FROM posts WHERE tag = '\" + req.query.tag + \"'\"); }\n",
      // A parameterized query passes the input as a value, not as SQL text (NA-03e: judged on the SQL argument only).
      "safe.js": "const mysql = require(\"mysql\");\nconst conn = mysql.createConnection({});\nexports.find = function find(req, res) { conn.query(\"SELECT * FROM users WHERE id = ?\", [req.query.id], () => {}); };\n",
    },
    expectations: [
      { id: "taint-sql:client-query", category: "taint", has: /^db\.js\|.*\|sink=#[0-9a-z]+:[^|]*query\|/ },
      { id: "taint-sql:pg-pool-query", category: "taint", has: /^pg\.js\|.*\|sink=#[0-9a-z]+:pg\.query\|/ },
      { id: "taint-sql:parameterized-query-is-safe", category: "taint", lacks: /^safe\.js\|/ },
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

/** `module:member` of the EXTERNAL call on `line` of `file` (ADR-012), or undefined when it is not EXTERNAL. */
function external(directory: string, file: string, line: number): string | undefined {
  const call = readJson(directory, "semantic.json").calls.find((item: { sourceFilePath: string; resolutionState: string; location?: { line: number } }) =>
    item.sourceFilePath.endsWith(file) && item.location?.line === line && item.resolutionState === "EXTERNAL");
  return call === undefined ? undefined : `${call.external.module}:${call.external.member}`;
}

/** The reason of the call to `callee` on `line` of main.js, or "RESOLVED" (A1). */
function callReason(directory: string, line: number, callee: string): string | undefined {
  const call = readJson(directory, "semantic.json").calls.find((item: { sourceFilePath: string; calleeName: string; location?: { line: number } }) =>
    item.sourceFilePath.endsWith("main.js") && item.calleeName === callee && item.location?.line === line);
  return call === undefined ? undefined : call.resolutionState === "UNRESOLVED" ? call.reason : call.resolutionState;
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
