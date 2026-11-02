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

import { readFileSync } from "node:fs";
import { join } from "node:path";

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
      { id: "discovery:ruby-file-discovered", category: "files", has: /^app\/controllers\/users_controller\.rb\|ruby\|/ },
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
    id: "projection",
    files: { "index.js": "export const a = 1;\n" },
    expectations: [
      { id: "projection:manifest-path-not-absolute", check: (directory) => !isAbsolutePath(readJson(directory, "manifest.json").repository.path) },
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
      { id: "taint-cross-file-direct:argument-reaches-callee-sink", category: "taint", has: /^helpers\.js\|.*\|sink=#[0-9a-f]+:res\.send\|/ },
      { id: "taint-cross-file-direct:returned-reaches-caller-sink", category: "taint", has: /^app\.js\|.*\|sink=#[0-9a-f]+:res\.json\|/ },
      { id: "taint-cross-file-direct:helpers-analyzed", category: "dispositions", has: analyzed("helpers.js") },
    ],
  },
  ...taintCases,
];

function readJson(directory: string, name: string): any {
  return JSON.parse(readFileSync(join(directory, name), "utf8"));
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
