# Red team of PR #328 (Phase C1c, branch feat/c1c-factory-forwarding @ 4df8c63)

Date: 2026-11-15. Baseline: origin/main @ 3d8eea7. Node v24.22.1.
Every probe was run three ways: under `node` (ground truth), with the engine on the PR head, and with the engine on origin/main.
Probe folders are in `redteam-pr328-probes/` next to this file. Each probe uses the same `lib.js` unless it says otherwise:

```js
// lib.js: a plain C1 factory
function realUse() { console.log("REAL use"); }
function createApplication() {
  var app = { use: realUse };
  return app;
}
module.exports = createApplication;
```

Tally: 55 probes. 21 give a false RESOLVED or EXTERNAL fact on the PR that origin/main does not give (three root causes, A to C below). 9 more show false claims that origin/main already makes (pre-existing, D). The rest held.

## A. NEW: writes through `module.exports` / `exports` reach the bound object

C1c binds `app` in `var app = module.exports = express()` to the call's result (call-graph-builder.ts:2327, 2717) and lets a forwarder's binding come from such a chain (factory-objects.ts:252). After that, `module.exports` (or `exports`) *is* the factory's object. The outside-write check still treats a write on a file's own `module.exports` / `exports` / `this` as never touching another module's object (class-hierarchy.ts:277 `isOwnObject`), and the forwarder's escape check (factory-objects.ts:260) only looks at `app.x = …`. So `module.exports.use = evil` replaces `app.use` and nothing notices.

p01, minimal (caller only, no forwarder):
```js
// main.js
var express = require("./lib");
var app = module.exports = express();
module.exports.use = function evil() { console.log("EVIL use"); };
app.use();
```
- node: `EVIL use`
- PR: `main.js@4:0|module|app.use|RESOLVED|function:realUse@1:0@lib.js`
- main: `main.js@4:0|module|app.use|UNRESOLVED|-`

The same hole, each confirmed (node prints EVIL, PR claims the real function, main is UNRESOLVED):
- p02 `var app = exports = module.exports = express(); exports.use = evil;`
- p03 forwarder: `function createApp() { var app = module.exports = express(); module.exports.use = evil; return app; }`
- p04 forwarder: `function createApp() { var app = exports = express(); exports.use = evil; return app; }`
- p53 same as p04 in a `.ts` file (Node runs it with type stripping).
- p48 the PR's own conformance files (application.js, express.js with merge-descriptors, index.js), plus one line in the caller:
  `var app = module.exports = express(); module.exports.set = function evilSet() {…}; app.set(…)`.
  node: `EVIL set`. PR: `app.js@4:0|module|app.set|RESOLVED|method:set@2:10@application.js`. main: UNRESOLVED.
- p30 EXTERNAL: lib copies `EventEmitter.prototype` with `Object.assign`. create.js forwarder does `var app = exports = express(); exports.on = evil;`.
  node: `EVIL on`. PR: `main.js@3:0|module|a.on|EXTERNAL|-`. main: UNRESOLVED.
- p43 another file writes through its own exports: `b.js: module.exports = require("./main"); module.exports.use = evil;` with main.js `var app = module.exports = express(); require("./b"); app.use();`. The root cause is partly pre-existing (see D5).

Held: p31. A caller-file chain for an EXTERNAL claim is blocked, because `factoryExternalTarget` also counts the caller file's own property writes.

## B. NEW: the forwarder's "never passed to a call / assigned to another name" check sees only the bare name

The escape check (factory-objects.ts:260-267) flags `app` only as an `Identifier` argument of a `CallExpression` / `NewExpression`, as the left object of `app.x = …`, or as the whole right side or initialiser. The docs promise more: "never reassigned, passed to a call, assigned to another name, or written by name in the function". Each probe below is create.js `function createApp() { var app = express(); <LINE>; return app; }` with `exports.createApp = createApp`, `function init() { this.use = function evil(){…} }`, and main.js `var a = require("./create").createApp(); a.use();`. Every one: node prints `EVIL use`, the PR says `main.js@3:0|module|a.use|RESOLVED|function:realUse@1:0@lib.js`, main says UNRESOLVED.

| probe | `<LINE>` | what the check misses |
|---|---|---|
| p15 | `init.call?.(app)` | OptionalCallExpression |
| p16 | ``tag`${app}` `` (tag runs `init.call(target)`) | TaggedTemplateExpression |
| p17 | `Object.assign?.(app, { use: evil })` | optional call (reflection, see note) |
| p21 | `init.call(...[app])` | spread argument |
| p22 | `init.call((0, app))` | sequence expression |
| p23 | `init.call(app \|\| null)` | logical expression |
| p24 | `var o = { app: app }; init.call(o.app)` | object-literal alias |
| p25 | `try { throw app } catch (e) { init.call(e) }` | throw/catch alias |
| p26 | `var [x] = [app]; init.call(x)` | destructuring alias |
| p27 | `delete app.use` | delete (node throws `TypeError: a.use is not a function`) |

Control p19: plain `init.call(app)` is caught (UNRESOLVED on the PR).

Notes:
- The write that changes `use` here is `this.use = …`, which the outside-write rule never counts. origin/main already gives a false RESOLVED when the *caller* does `init.call(app)` directly (D1). So what the PR adds is a forwarder condition that claims to stop this but is easy to step around.
- p17 uses `Object.assign`. The "No reflection" assumption arguably excuses it. The others use no reflection.

## C. NEW: an Annex B block function rebinds the callee

The engine scopes a function declared in a block to that block. Node runs CommonJS as sloppy code, where Annex B also assigns that function to the module-level name when the block runs. `callSourceOf` (factory-objects.ts:1113) keeps only module-scope functions, so it misses the block one.

p28:
```js
function realUse() { console.log("REAL use"); }
function fakeUse() { console.log("FAKE use"); }
function express() { var o = { use: realUse }; return o; }
if (true) { function express() { var o = { use: fakeUse }; return o; } }
function createApp() { var app = express(); return app; }
var a = createApp();
a.use();
var b = express();
b.use();
```
- node: `FAKE use`, `FAKE use`
- PR: `main.js@7:0|module|a.use|RESOLVED|function:realUse@1:0@main.js`; `b.use` UNRESOLVED
- main: both UNRESOLVED (the direct call is handled; only the new forwarder path is fooled)

p06: the same with `var express = require("./lib")` instead of the top-level function. node `FAKE use` twice. The PR resolves both `a.use` and `b.use` to `realUse@lib.js`. main resolves `b.use` falsely too (pre-existing for the direct call), and `a.use` is new.

## D. Pre-existing false claims (origin/main already makes them)

1. `this.use = …` in any file is exempt from the outside-write rule. p18 `var app = express(); init.call(app); app.use()` and p20 (with `init` in helper.js). node EVIL; main and PR both say RESOLVED realUse.
2. p29 `var app = express(); delete app.use; app.use()`: node throws TypeError; main and PR both say RESOLVED realUse.
3. `module.exports` replaced through an alias of `module` is not counted (p36 re-export file, p37 factory file: `var m = module; m.exports = fake`). node EVIL. main resolves the direct `b.use` to realUse, and the PR adds the forwarder `a.use`.
4. A module-level `function require(p) {…}` shadows `require`. p40: node EVIL twice. main resolves the direct `b.use`; the PR also resolves the forwarder `a.use`.
5. Writes on a file's own exports after `module.exports = require("./main")` (p44) or `exports = require("./main")` (p45) land on main.js's factory object. node EVIL; main and PR both say RESOLVED realUse.
6. A factory's ids match export symbols by name only (factory-objects.ts:394). A function nested in another function, named like the exported one, takes the export's id. p52: node `REAL use`; main and PR both say `RESOLVED function:fakeUse@3:25@create.js`. (p32, p49 and p51 were false on main only; the PR fixes them as a side effect.)
7. C1b: a module-scope factory's `{ setTimeout }` resolves to a `setTimeout` function nested inside another function (p50). node runs the global; main and PR both say `RESOLVED function:setTimeout@1:19@main.js`.

## What held

- p05 `var express = require(…)` plus `function express` at top level: the parser rejects the file (VarRedeclaration); no facts.
- p07 block `let express` shadowing; p08 duplicate function declarations; p09/p10 named function expression exported under the forwarder's name; p33/p34 export through a parameter of the same name.
- p12/p13 `eval` in the forwarder file (including one that rebinds the callee); p14 `with`.
- p19 plain `init.call(app)` in the forwarder.
- p38/p39 forwarder or factory reassigned before export; p46 the same in ESM; p47 `var` redeclaration of the caller's binding.
- p41 a cycle between two forwarders; p42 hop limit (7 forwards resolve correctly, 8 or more stay UNRESOLVED).
- p56 callee shadowed inside the forwarder by a destructured default parameter, a `catch` parameter, a function in a nested block, `for (var express of …)` and a rest parameter, all UNRESOLVED. A named function expression in a default parameter (does not bind in the body) correctly resolves.
- p11 sanity: cross-file forwarding through `module.exports = createApp` and `exports.createApp = createApp` resolves correctly.
- ESM forwarders are not followed at all (p55 sanity is UNRESOLVED), so p54 cannot fool it.

## Rerunning

`run.sh <probe> [entry] [grep]` runs node, then the engine on the PR worktree, then on a main worktree. Set `S` to a folder holding `probes/` and `main-wt/` (a `git worktree add --detach main-wt origin/main` with `bun install`, and the probe runner copied to `legacy-exodus-core/benchmarks/.probe-run.ts`). Also edit the `PR=` path in it.
