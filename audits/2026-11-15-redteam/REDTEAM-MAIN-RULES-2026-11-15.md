# Red team of `main`'s resolution rules (2026-11-15)

- Revision: `origin/main` 3d8eea7 (detached worktree `redteam-main-rules-75fb2c`, clean afterwards).
- Tools: Bun 1.4.4 (engine), Node v24.22.1 (ground truth), Windows 11.
- Runner: the blind-audit-b `run-probe.ts`, copied to `legacy-exodus-core/benchmarks/.probe-run.ts` and deleted afterwards.
- Probes: 78 folders, all in `redteam-main-rules-probes/` next to this file; `run.sh <folder> [entry]` runs the engine, then node.
- EXTERNAL lines show `-` in the target column: this runner does not print the external target.

## Totals (every number below is from these 78 probe runs)

| Outcome | Probes |
|---|---|
| False RESOLVED/EXTERNAL that the docs do not excuse | 45 |
| False, but excused by a documented assumption or code comment | 2 |
| Held (UNRESOLVED or correct) | 30 (2 of them are parser refusals, see "Held") |
| Not checked under Node | 1 (lerna link) |

The 45 false claims fall into 18 root causes: 1 High, 9 Medium, 8 Low.

## High

### H1. Rules 1 and 2 ignore writes from other files
Rule 1 is `const c = new C(); c.m()`; rule 2 is the object-container rule, `app.init = function …; app.init()`. Neither appears in "Assumptions behind RESOLVED". The first assumption excuses only computed and reflective access from other files; these probes use a plain named assignment.
Root cause, by reading: `call-graph-builder.ts:2297-2303` (rule 1) and `containerMethod` at 2238-2252 (rule 2) count writes in the calling file only (`propertyWriteCount`). Rule 1e at 2346 does call `hierarchy.isWrittenOutside`; these two rules do not.

`r2-xwrite`
- lib.js: `const app = {}; app.init = function () { return "init"; }; app.start = function () { return app.init(); }; module.exports = app;`
- main.js: `const app = require("./lib"); app.init = function () { return "patched-init"; }; console.log(app.start());`
- node: `patched-init`
- engine: `lib.js@3:33|start|app.init|RESOLVED|method:init@2:11@lib.js`

`r1-xwrite`
- lib.js: `class C { m() { return "C.m"; } } const c = new C(); function go() { return c.m(); } module.exports = { c, go };`
- main.js: `const lib = require("./lib"); lib.c.m = function () { return "patched-from-other-file"; }; console.log(lib.go());`
- node: `patched-from-other-file`
- engine: `lib.js@3:23|go|c.m|RESOLVED|method:m@1:10@lib.js`

Variants: `r1-xwrite2` and `r2-xwrite2` export through `exports.c` / `exports.app` with a destructured import. Both give the same false RESOLVED.

Severity High: replacing a method of an exported module object or instance by assignment is common. Examples are test stubs written as `db.query = fake`, plugins and config overrides.

## Medium

### M1. Destructuring and `for…of` targets are not counted as property writes by the rule-specific write checks
The engine's same-file tracker (`collectBindingWrites`, `call-graph-builder.ts:946-995`, 1058-1067) counts these writes. These separate checks do not:
- the factory file check (`factory-objects.ts:175-184`);
- `class-hierarchy.ts:155-159` (counts a write only when the parent is an AssignmentExpression);
- `collectForeignExportWrites` (`call-graph-builder.ts:801-814`);
- the global-write collector.

| Probe | Rule | node | engine |
|---|---|---|---|
| `x-class-destr` (other file: `[inst.m] = [fn]`) | `this.m()` / XA-03 | `patched-by-destructuring` | `lib.js@1:24\|go\|this.m\|RESOLVED\|method:m@1:36@lib.js` |
| `x-class-forof` (`for (inst.m of [fn]);`) | `this.m()` | `patched-by-for-of` | same line |
| `f-destr-write` (`[x.run] = [fn]`, factory's file) | C1 | `patched-by-destructuring` | `main.js@4:12\|module\|x.run\|RESOLVED\|variable:run@1:30@main.js` |
| `f-forof-write` | C1 | `patched-by-for-of` | same line |
| `c2-local` (other file: `for (inst.m of [fn]);`) | C2 | `patched-by-for-of` | `lib.js@5:41\|go\|x.m\|RESOLVED\|method:m@2:16@lib.js` |
| `c2-ctor-destr` (`function F(fn) { [this.m] = [fn]; }`) | C2 / XB-07 | `own-m-by-destructuring` | `main.js@4:12\|module\|x.m\|RESOLVED\|method:m@2:16@main.js` |
| `x-pkg-destr` (`[path.join] = [fn]`) | B1 | `patched-join` | `main.js@3:12\|module\|path.join\|EXTERNAL\|-` |
| `x-glob-destr` (`[Math.max] = [fn]`) | B1b | `patched-max` | `main.js@2:12\|module\|Math.max\|EXTERNAL\|-` |
| `x-glob-forof` (`for (JSON.stringify of [fn]);`) | B1b | `patched-stringify` | `main.js@2:12\|module\|JSON.stringify\|EXTERNAL\|-` |

Severity Medium: the syntax is uncommon, but the gap is silent and spans five rules.

### M2. String-key bracket writes (`o["m"] = f`) are not counted by `factory-objects.ts`
These checks skip `computed === true` at `factory-objects.ts:178` (C1), 537 (C3a) and 678 (C2). The C1b named-export path (409) counts only assignments, so it also misses `Object.defineProperty(exports, "add", …)`. The C3a docs say a literal-key `defineProperty` counts as a write.

| Probe | Rule | node | engine |
|---|---|---|---|
| `c3a-strkey` (lib: `module.exports = { run: function … }; module.exports["run"] = function () { return "string-key-run"; };`) | C3a | `string-key-run` | `main.js@2:12\|module\|lib.run\|RESOLVED\|export:run@1:19@lib.js` |
| `c2-strkey` (`x["m"] = fn` after `const x = new F()`) | C2 | `own-m-by-string-key` | `main.js@5:12\|module\|x.m\|RESOLVED\|method:m@2:16@main.js` |
| `f-strkey-write` | C1 | `patched-by-string-key` | `main.js@4:12\|module\|x.run\|RESOLVED\|variable:run@1:30@main.js` |
| `c1b-named-strkey` (lib: `exports.add = add; exports["add"] = other;`, factory `{ add: lib.add }`) | C1b | `replaced-by-string-key` | `main.js@4:12\|module\|x.add\|RESOLVED\|function:add@1:0@lib.js` |
| `c1b-named-defprop` (lib: `exports.add = add; Object.defineProperty(exports, "add", { value: other });`) | C1b | `replaced-by-defineProperty` | same line |

Caveat: the docs excuse "a computed write (`fastify[kState] = …`)". Those examples use non-literal keys. Elsewhere the engine treats `o["m"]` as a write of `m` (`memberPropertyName`/`staticPropertyKey`, `collectForeignExportWrites`). If the owner reads "computed" to include string-literal keys, four of these five become a doc clarification. The `defineProperty` case stays a bug either way.

Severity Medium: ES3-style writes such as `exports['delete'] = …` still occur in older code.

### M3. The own-exports exemption trusts writes after `module.exports = require("./x")`
| Probe | Rule | node | engine |
|---|---|---|---|
| `x-c3a-ownexp` (patch.js: `module.exports = require("./lib"); module.exports.run = function () { return "patched-via-own-exports"; };`) | C3a | `patched-via-own-exports` | `main.js@3:12\|module\|lib.run\|RESOLVED\|export:run@1:19@lib.js` |
| `x-class-ownexp` (same patch; lib exports `new C()`) | `this.m()` | `patched-via-own-exports` | `lib.js@1:24\|go\|this.m\|RESOLVED\|method:m@1:36@lib.js` |
| `x-class-exportsalias` (`exports = module.exports = require("./lib"); exports.m = …`) | `this.m()` | `patched-via-exports` | same line |

The alias form `const api = module.exports; api.m = …` held (`x-class-ownalias`).

Severity Medium: re-export-and-extend files are common; overriding an existing method that way is less so.

### M4. A class instance used as another object's prototype
| Probe | node | engine |
|---|---|---|
| `c-proto-literal-x` (lib exports `new C()`; main: `const child = { __proto__: base, m() { return "child.m"; } }; child.go()`) | `child.m` | `lib.js@1:24\|go\|this.m\|RESOLVED\|method:m@1:36@lib.js` |
| `c-proto-literal` (same, one file) | `child.m` | `main.js@1:24\|go\|this.m\|RESOLVED\|method:m@1:36@main.js` |
| `c-objcreate-desc` (`Object.create(new C(), { m: { value: fn } })`) | `descriptor.m` | same line |

No assumption covers this: the literal is not a write, and the reflection excuse applies to other files only. Severity Medium.

### M5. B1c ignores same-file reflection onto the literal
`call-graph-builder.ts:2746` checks `propertyWrites` only. It never checks `unknownPropertyWrites`, which the same collector sets for these probes.

| Probe | node | engine |
|---|---|---|
| `b1c-protokey` (`const out = []; out.__proto__ = { push() { return "fake-push"; } }; out.push(1)`) | `fake-push` | `main.js@3:12\|module\|out.push\|EXTERNAL\|-` |
| `b1c-setproto` (`Object.setPrototypeOf(out, {...})`) | `fake-push` | same form |
| `b1c-assign` (`Object.assign(out, extra)`) | `fake-push` | `main.js@4:12\|module\|out.push\|EXTERNAL\|-` |

Severity Medium: `arr.__proto__ = X.prototype` was an ES5 idiom for subclassing arrays.

### M6. `#imports` and self-reference conditions ignore `require` versus `import`
`module-resolver.ts:266` and 308-312 try a fixed list: `source`, `import`, `require`, `node`, `default`, `types`. A CommonJS `require` therefore gets the `import` target.

`m-imports-cond`
- package.json: `{ "name": "app", "imports": { "#impl": { "import": "./impl.mjs", "require": "./impl.cjs" } } }`
- impl.mjs returns `"esm-run"`; impl.cjs returns `"cjs-run"`
- main.js: `const impl = require("#impl"); console.log(impl.run());`
- node: `cjs-run`
- engine: `main.js@2:12|module|impl.run|RESOLVED|export:run@1:0@impl.mjs`

`m-self-cond` uses the same `exports` map with `require("app")`. Node prints `cjs-run`; engine: `main.js@2:12|module|app.run|RESOLVED|export:run@1:0@impl.mjs`.

Workspace packages (S3) use the same function; that path was not probed. Severity Medium.

### M7. A factory value matches a same-named function from any scope
`factory-objects.ts:313`: when the factory does not bind the name itself, every function of that name in the file is a candidate.

`f-nested-pick`
- lib.js: `exports.run = function () { return "lib-run"; };`
- main.js:
  ```js
  const { run } = require("./lib");
  function helper() { function run() { return "helper-inner-run"; } return run(); }
  function make() { return { run }; }
  const x = make();
  console.log(x.run(), helper());
  ```
- node: `lib-run helper-inner-run`
- engine: `main.js@5:12|module|x.run|RESOLVED|function:run@2:20@main.js`

PR #328 edits this line. By reading only (not run on that branch), it still accepts every same-named function for a module-scope factory. Severity Medium: common names (`log`, `next`, `done`, `run`) often appear both as an import and as a nested helper.

### M8. A `file:` dependency is EXTERNAL although Node runs a repository function
`ext-file-dep`
- package.json: `{ "name": "root", "private": true, "dependencies": { "mylib": "file:./packages/mylib" } }`
- packages/mylib/package.json: `{ "name": "mylib", "main": "index.js" }`
- packages/mylib/index.js returns `"repo-mylib-run"`
- main.js: `const mylib = require("mylib"); console.log(mylib.run());`
- engine (checkout without node_modules): `main.js@2:12|module|mylib.run|EXTERNAL|-`
- node, after `npm install --offline --ignore-scripts` links `node_modules/mylib` to `packages/mylib`: `repo-mylib-run`

ADR-012 says EXTERNAL is "not a function in the repository". A lerna-style link (`ext-lerna`) also gives EXTERNAL; it was not checked under Node. Severity Medium.

### M9. A circular `require` hands the importer a stale exports object
`cyc-c3a`
- a.js: `const b = require("./b"); module.exports = { run: function () { return "a-run"; } }; console.log(b.go());`
- b.js: `const a = require("./a"); exports.go = function () { try { return a.run(); } catch (e) { return "THROWS " + e.message; } };`
- main.js: `require("./a");`
- node: `THROWS a.run is not a function` (Node also warns about the circular dependency)
- engine: `b.js@2:40|go|a.run|RESOLVED|export:run@2:19@a.js`

`cyc-factory` (a.js does `module.exports = make`): Node prints `THROWS make is not a function`. The engine gives:
- `b.js@2:43|go|make|RESOLVED|export:default@3:0@a.js`
- `b.js@2:58|go|x.run|RESOLVED|variable:run@2:30@a.js`

The result depends on load order: with b.js as the entry point, the call works. Severity Medium.

## Low

1. **Factory fall-through returns `undefined` (C1/C1b).**
   - `f-fall-direct`: `function make(flag) { if (flag) return { run() {…} }; }` and `make(false).run()`. Node: `THROWS Cannot read properties of undefined (reading 'run')`. Engine: `main.js@5:18|module|x.run|RESOLVED|method:run@2:21@main.js`.
   - `f-fall-named`: same with `const o = {…}; if (flag) return o;`. Engine: `main.js@6:18|module|x.run|RESOLVED|variable:run@2:14@main.js`.
2. **Factory receiver not bound when the call runs (C1).**
   - `cond-var`: `if (process.argv.length > 99) { var x = make(); } x.run()`. Node throws. Engine: `main.js@3:18|module|x.run|RESOLVED|variable:run@1:30@main.js`.
   - `r1-inline-tdz`: `use(); const x = make(); function use() { return x.run(); }`. Node: `THROWS Cannot access 'x' before initialization`. Engine: `main.js@4:24|use|x.run|RESOLVED|variable:run@1:30@main.js`.
3. **`delete` is not a write (C1, B1, B1b).**
   - `g-delete`: patch `delete JSON.stringify`. Node: `THROWS JSON.stringify is not a function`. Engine: `main.js@2:18|module|JSON.stringify|EXTERNAL|-`.
   - `p-delete`: `delete require("path").join`. Engine: `main.js@3:18|module|path.join|EXTERNAL|-`.
   - `f-delete`: `delete x.run`. Node: `THROWS x.run is not a function`. Engine: `main.js@4:18|module|x.run|RESOLVED|variable:run@1:30@main.js`.
4. **A self-reference named like a built-in (XB-02).** `m-self-builtin`: package.json `{ "name": "url", "exports": "./index.js" }`, then `require("url").parse(...)`. Node uses the built-in and prints `real.example`. Engine: `main.js@2:12|module|url.parse|RESOLVED|export:parse@1:0@index.js`. Cause: `module-resolver.ts:79-81` has no built-in check before workspace and self-reference lookup.
5. **`"type": "module"` `.js` file (B1b).** `type-module`: `require("path")` in a `.js` file under `{ "type": "module" }`. Node: `THROWS require is not defined`. Engine: `main.js@1:16|module|require|EXTERNAL|-`. Cause: `call-graph-builder.ts:104-105` decides CommonJS from the extension and the absence of import/export syntax, never from package.json `type`.
6. **A class-body getter replaces an earlier method (`this.m()`).** `c-dup-getter`: `class C { m() {…} go() { return this.m(); } get m() { return () => "from-getter"; } }`. Node: `from-getter`. Engine: `main.js@1:49|go|this.m|RESOLVED|method:m@1:10@main.js`.
7. **A package patched through a repository wrapper (B1).** `b1-wrapper-patch`: myfs.js `module.exports = require("fs")`; patch `require("./myfs").readFileSync = fn`. Node: `patched-through-wrapper`. Engine: `main.js@3:12|module|fs.readFileSync|EXTERNAL|-`. The XB-03 doc bullet says aliases of repository modules are not followed; it does not clearly cover this.
8. **An Annex B block function replaces a C3a shorthand export.** `annexb-c3a`: `function run(){…"top-run"} if (true) { function run(){…"block-run"} } module.exports = { run };`. Node: `block-run`. Engine: `main.js@2:12|module|lib.run|RESOLVED|export:run@3:19@lib.js`. The symbol facts mark `function run@1:0` as exported and `run@2:12` as local. The call fact itself names the export entry, so the falsity is in the symbol link. The same-file call (`annexb-local`) is correctly UNRESOLVED.

## False but excused (no bug by the docs)

- `c2-init-assign`: `function F(o) { this.init(o); } F.prototype.init = function (o) { Object.assign(this, o); }`. Node: `own-m-from-opts`. Engine: `main.js@5:12|module|x.m|RESOLVED|method:m@3:16@main.js`. Excused by "a call that receives `this` inside the constructor is assumed not to write the name". This ES5 pattern is common, so the assumption is broad.
- `b1c-computed`: `const k = "push"; out[k] = fn`. Engine: EXTERNAL. Excused by the computed-write comment at `call-graph-builder.ts:2728`; the B1c doc bullet itself does not state it.

## Held

- **Factories:** `f-tdz` (`var` receiver used before its declarator: UNRESOLVED).
- **Class `this.m()`:** `c-inst-write`, `c-defprop-same`, `c-es5-sub`, `c-dup-method`, `c-classexpr-sub`, `c-ctor-escape` (`class Sub extends inst.constructor` in another file).
- **C3a, C3b and own-exports aliases:**
  - `x-c3a-destr` (the write is in the caller's own file);
  - `c3a-alias-replace`;
  - `x-class-ownalias`;
  - `c3b-getter` (copy from a module whose export is a getter);
  - Node 24's own `EventEmitter.prototype` names match the C3b list exactly.
- **C2:** `c2-dup-proto`, `c2-xdestr`.
- **B1b globals:**
  - `g-global` (`global.setImmediate = …`);
  - `g-assign-globalthis` (`Object.assign(globalThis, …)`);
  - `g-globalthis-strkey`;
  - `b1c-ctor-replaced` (`global.Map = class …`);
  - `b1c-ctor-implicit` (`Map = class …`).
- **B1 packages:** `b1-destr-alias` (`const { promises } = require("fs"); promises.readFile = …`).
- **ESM/CJS mixing:**
  - `esm-detect` (`.js` file with import syntax: `require` UNRESOLVED);
  - `m-esm-named-cjs` (resolved, and Node 24 agrees);
  - `m-esm-default-esmodule` and `m-esm-default-esmodule2` (`__esModule` default import);
  - `esm-default-ns` (ESM default import versus named export).
- **Shadowing and scopes:**
  - `req-shadow` (`require` as a parameter);
  - `m-nested-scope-imports` and `m-nested-scope-self` (a nameless nested package.json blocks `#imports` and self-reference, as in Node);
  - `annexb-local`.
- **Parser refusals:** `f-var-redecl` and `f-dup-decl`. The parser refuses `function f(){}` plus `var f`, or two `function f`, at the top of a CommonJS file (a module-goal parse). The disposition is an explicit `VarRedeclaration`, with no false facts. It is a coverage gap, not a false claim.
