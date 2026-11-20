# LegacyExodus cross-file blind audit B (10 Nov 2026)

Audit of `legacy-exodus-core` on `main` = `fdc37f3` (#315). The previous audit (XA-01..08, run 9 Nov) already
uses the folder `2026-11-10-blind-audit`, so this one is `2026-11-10-blind-audit-b`.

Method: findings were formed from the code, the tests and probe programs before the earlier reports were read.
Every finding has a probe in [`probes/`](probes/) and Node's own behaviour as ground truth. The engine was not
changed. The newest code was probed hardest: `src/semantic/class-hierarchy.ts`, function-level `require` scoping
(#290), directory `main` (#291), and Phases B1–C2 (#309–#315: EXTERNAL calls, `src/semantic/factory-objects.ts`).

Run a probe: `cd legacy-exodus-core && bun run ../audits/2026-11-10-blind-audit-b/probes/run-probe.ts <probe-dir> [category…|ALL]`
(prints the facts the Fact Diff reads; default category `calls`).

## 1. Baseline gates on `fdc37f3`

| Gate | Command | Result |
|---|---|---|
| Typecheck | `bun run typecheck` | pass (exit 0) |
| Full suite | `bun test` | **2,397 pass, 1 skip, 1 fail** in 436 s. The failure is `flow-stage-scaling.test.ts` "one long function … at most 4.5x": measured 4.62 while probes ran in parallel. Alone (`bun test tests/unit/flow/flow-stage-scaling.test.ts`) it passes 2/2. A load-sensitive timing ratio, not a regression |
| Accuracy | `bun run benchmarks/cli.ts accuracy` | **236/236 planted facts (100%), 39/39 controls (100%), 0 known gaps, 0 regressions** |
| Determinism | `analyze --refresh` on two copies of pinned koa; SHA-256 of every `.discovery` file | 12 of 13 files identical; `manifest.json` differs only in run identity, location digest and MAC, as ADR-010 intends |
| CI | `gh pr checks 316`; check-run annotation | **GitHub Actions is not running.** Every job on PR #316 failed in 1–2 s: "The job was not started because recent account payments have failed or your spending limit needs to be increased." `main`'s last CI (on `fdc37f3`) was green |
| Ghost scale | — | Not re-run in this audit |

## 2. Findings

| ID | Sev | Finding | New code? |
|---|---|---|---|
| XB-01 | High | Arrow functions and function expressions get no data-flow summary, so taint stops at them | No (also on `d30ffaa`) |
| XB-02 | Medium | `#imports` and package self-references are EXTERNAL and have no module edge, though they load repository files | B1 |
| XB-03 | Medium | A global, a built-in prototype or a package patched through an alias (or by same-file `Object.assign`) still gives EXTERNAL | B1, B1b, B1c |
| XB-04 | Medium | Factory objects (C1): a block-scoped shadow or a destructuring reassignment of the returned name gives a false RESOLVED | C1 |
| XB-05 | Low | Prototypes (C2): a method named like an `Object.prototype` member, called before its assignment, resolves to the later method | C2 |
| XB-06 | Low | An `async` or generator factory resolves `make().m()`, which throws on a Promise or iterator | C1 |
| XB-07 | Low | `Object.assign(this, opts)` in a constructor function: the prototype method is RESOLVED, the class version is not | C2 |
| XB-08 | Info | An ESM directory import resolves through `package.json` `main`; Node throws `ERR_UNSUPPORTED_DIR_IMPORT` | #291 |
| XB-09 | Info | CI does not run (Actions billing), so no PR can meet the merge gate; one timing test is load-sensitive | Process |

### XB-01 (High): arrow functions and function expressions get no data-flow summary

- **Probe** `probes/tv-runtime/app.js`, proven by `node probes/prove-tv-runtime.js` → `execSync received ["TAINT"]`:
  ```js
  const runArrow = (cmd) => cp.execSync(cmd);
  exports.h = function h(req, res) { runArrow(req.query.c); res.end(); };
  ```
  The engine resolves `runArrow` (RESOLVED `function:runArrow@2:17`) and reports **no taint flow**. The same helper
  written as `function runLocal(cmd) {…}` (`probes/tv-local`) gives a CONFIRMED flow to `child_process.execSync`.
- **Shapes that lose the flow** (each probe has the same sink): `const f = (x) => …` (`tv-sarrow`),
  `const f = function (x) {…}`, `exports.f = function (x) {…}` (`tv-fnexp`). Shapes that keep it: a function
  declaration, an object method `{ f(x) {…} }` (`tv-objm`).
- **Cause.** `dfg-summaries` has no entry for these functions, so the call's arguments never reach a parameter
  (`dfg-bindings` shows the binding to `function:runArrow`, with nothing on the other side).
- **Reach.** On pinned axios `lib/`, **83 of 201** function and method symbols (41%) have no summary; all are
  arrows or function expressions. Express `lib/` has 8 such definitions at the top of files, axios 47.
- **Second symptom.** A call inside such a function is labelled with the enclosing caller (`app.js@2:26|module|cp.execSync`),
  as if the module ran it at load time. The edge-stable key does know the container
  (`app.js#runArrow:function/call:cp.execSync@0`), so this is a label, but it misleads any reader of `calls`.
- **Why it matters.** A missing flow reads as "no flow". This is the same class of silent loss as XA-01, wider, and
  it predates the newest code (the same probe gives no flow on `d30ffaa`). No conformance case puts a sink behind an
  arrow helper, which is why 51/51 taint holds.

### XB-02 (Medium): `#imports` and self-references are EXTERNAL with no module edge

- `probes/pk-hash`: `package.json` `"imports": { "#util": "./src/util.js" }`; `require('#util').f()`. Node prints
  `repo util.f`. The engine: `util.f|EXTERNAL`, and no `module-edges` or `import-edges` fact at all.
- `probes/pk-self`: a package requiring itself by name through its own `exports` (`require('selfpkg/helpers')`).
  Node runs the repository file; the engine says `helpers.h|EXTERNAL`, no module edge.
- **Why it matters.** EXTERNAL claims "not a function in the repository" (ADR-012). Here it is one, so call, data
  flow and taint into those files stop, and dead-code findings can name live code. Subpath imports are standard
  Node (12.19+) and common in TypeScript projects. Not present in the pinned corpora (grep of `"imports"` and
  `require('#`/`from '#'` finds none; self-references are only in comments and in axios's own module tests).

### XB-03 (Medium): patches through an alias or by same-file reflection keep EXTERNAL

`collectGlobalWrites` and the package-write check match the written path by its root name. Writes through another
name are missed. Node shows the repository code running in each case:

| Probe | Patch | Call | Engine |
|---|---|---|---|
| `ex-alias` | `const c = console; c.log = function () {…}` (other file) | `console.log('x')` | EXTERNAL |
| `ex-poly` | `var ArrayProto = Array.prototype; ArrayProto.includes = …` (other file) | `[1, 2].includes(1)` | EXTERNAL |
| `ex-pkgalias` | `const p = require('path'); … p.join = …` via a second alias (other file) | `path.join('a','b')` | EXTERNAL |
| `ex-define` | `Object.assign(JSON, { parse … })` (**same file**) | `JSON.parse('1')` | EXTERNAL |

The stated rule is "EXTERNAL when no file writes that path" (Current Implementation, B1/B1b). These are plain named
writes, not the computed or reflective writes the assumptions exclude (the last one is in the calling file, which
the assumptions do not exclude). `Object.defineProperty(String.prototype, 'trim', …)` in the same file is handled
(UNRESOLVED). The `var ArrayProto = Array.prototype` alias is the lodash/underscore idiom; in the pinned corpora it is
only read, never written, so no corpus fact is wrong today. Legacy code with home-grown polyfills is the target market.

### XB-04 (Medium): C1 factory with a shadowed or destructured returned name

`collectFactoryFacts` matches the returned name by string inside the factory body, not by binding:

- `probes/c1-block`: `function make() { if (true) { const o = { run… } } return o }` returns the **module** `o`. Node:
  `module-o`. Engine: `app.run|RESOLVED|variable:run@3:26` (the block literal).
- `probes/c1-destr`: `let o = { run… }; [o] = [other]; return o`. Node: `swapped`. Engine: RESOLVED to the literal's
  `run`. The check looks only for `o = …` with an identifier on the left.

Both break the documented condition ("one never-reassigned literal"). The shared rebinding check is right where it
is used: B1c on `[out] = […]`, `for (s of …)` and `({ m } = …)` stays UNRESOLVED (`probes/b1c-destr` in the
working set). The fix is to use the scope and rebinding machinery instead of name matching.

### XB-05 (Low): `Object.prototype` names before a C2 assignment

`probes/c2-objproto`: `const f = new F(); f.toString(); F.prototype.toString = …`. Node runs
`Object.prototype.toString` (`[object Object]`). Engine: RESOLVED to the later `F.prototype.toString`. Current
Implementation justifies early calls with "a fresh prototype has no `m`", which is false for `toString`, `valueOf`,
`hasOwnProperty`, `isPrototypeOf`, `propertyIsEnumerable`, `toLocaleString`. The `readyAt` guard exists only when a
parent link is present.

### XB-06 (Low): `async` and generator factories

`probes/c1-async`: `async function make() { const o = { run… }; return o }`, `const app = make(); app.run()`. Node
throws `TypeError` (a Promise has no `run`). Engine: RESOLVED. Same class as XA-05 (a RESOLVED call that cannot run).
The factory collector does not look at `async` or `generator`.

### XB-07 (Low): `Object.assign(this, opts)` in a constructor function

`probes/c2-assign`: `function Job(opts) { Object.assign(this, opts) }; Job.prototype.step = …`, `new Job({ step… }).step()`.
Node: `own`. Engine: RESOLVED to `Job.prototype.step`. The class form (`probes/ch-assign`) stays UNRESOLVED. Current
Implementation says reflection "onto the instance (`Object.assign(x, …)`)" is not followed, so this is within the
stated assumption, but it is the most common way old code gives an instance its own methods and the class path
already handles it. Not found in the pinned corpora's constructors (`grep 'Object.assign(this'`: one hit, a computed
property in Fastify).

### XB-08 (Info): ESM directory import

`probes/dm-esm`: `"type": "module"`, `import { f } from './lib'` with `lib/package.json` `main`. Node:
`ERR_UNSUPPORTED_DIR_IMPORT`. Engine: `f|RESOLVED`. A bundler would accept it, so this is a labelling question, not a
wrong target.

### XB-09 (Info): CI and one timing test

- GitHub Actions jobs are not starting (billing annotation above). Until that is fixed, no PR can meet the owner's
  merge gate. PR #316 (C3) is waiting on it.
- `flow-stage-scaling.test.ts` compares wall-time ratios (4.5x ceiling) and failed once at 4.62 under load.

## 3. Checked and holding

| Area | Probes | Result |
|---|---|---|
| `this.m()` (class-hierarchy) | `Object.assign(this, …)` and `Object.defineProperty(this, 'm', …)` in a constructor; static `this.m()` vs instance `m`; getter `m`; `this` in a `map` callback with `thisArg` | All UNRESOLVED or right; no false RESOLVED |
| Function-level `require` (#290) | `var` require in a block then use; conditional rebinding; `try`/`catch` fallback require | All UNRESOLVED |
| Directory `main` (#291) | `main` vs `exports` in a nested `package.json` (Node uses `main`); missing `main` falls back to `index.js` | Both match Node |
| Module exports | ESM live binding reassigned by `swap()`; two `export *` exporting the same name; conditional `exports.f` reassignment | All UNRESOLVED |
| Global shadowing | Annex B block function `setTimeout`; hoisted `var JSON`; parameter and `catch` binding named `console` | None EXTERNAL |
| B1c rebinding | `[out] = […]`, `for (s of …)`, `({ m } = …)` | UNRESOLVED |
| Package writes (B1) | `require('fs').x = …` style (conformance), and a file that patches `cp.execSync` | UNRESOLVED |
| Taint end to end | Express handler → factory method (C1) → `execSync`; → prototype method (C2) → `readFileSync` | Calls RESOLVED; flows missing only where the method is a function expression (XB-01) |
| Determinism | Two fresh koa runs | Fact artifacts byte-identical |

## 4. Scores (same 11 dimensions and weights)

| # | Dimension | Weight | Score | Evidence |
|---|---|---|---|---|
| 1 | Architecture and code quality | 10% | 7.5 | Stages and ADRs clear. `call-graph-builder.ts` is now 2,723 lines; `factory-objects.ts` re-implements binding checks by name (root of XB-04) |
| 2 | Language frontend | 15% | 8.0 | No new frontend issue found; XA-06 fix not re-probed |
| 3 | Symbols, scopes, module resolution | 15% | 7.0 | #290/#291 hold under new probes. XB-02 misses whole module edges; XB-08 |
| 4 | Call graph | 10% | 6.5 | XA-02..05 fixed; B and C phases add EXTERNAL and receivers with 0 oracle contradictions (per PRs). New: three false RESOLVED shapes (XB-04..06) and four false EXTERNAL shapes (XB-02, XB-03) |
| 5 | CFG | 5% | 7.5 | Not re-probed; flow oracle (A4) added since |
| 6 | DFG and taint | 15% | 5.5 | XA-01 fixed and 51/51 taint cases hold, but XB-01: 41% of axios `lib` functions carry no flow summary |
| 7 | Framework semantics | 5% | 4.0 | Express only |
| 8 | Determinism, trust, security | 10% | 9.0 | Re-verified on koa |
| 9 | Scale and performance | 5% | 7.5 | Not re-measured (no Ghost run) |
| 10 | Testing and verification | 5% | 7.5 | Accuracy 236/236, call and flow oracles are real progress. No conformance case has a sink behind an arrow helper; a timing-ratio test is load-sensitive |
| 11 | Docs and governance truthfulness | 5% | 6.5 | Assumptions section is detailed and mostly right. C2's "an early call throws" is wrong for `Object.prototype` names (XB-05); B1's "no file writes that path" is not what the code checks (XB-03); CI is down |
| | **Overall** | | **≈ 70** | Weighted 7.03 |

## 5. Comparison with earlier reports

| # | Dimension | 8 Nov | 9 Nov self | XA (9 Nov) | **XB (10 Nov)** | Why |
|---|---|---|---|---|---|---|
| 1 | Architecture | 8.0 | 8.5 | 8.0 | 7.5 | Bigger call-graph file; C1 duplicates scope logic |
| 2 | Frontend | 8.0 | 8.5 | 8.0 | 8.0 | No change found |
| 3 | Symbols / resolution | 7.0 | 8.0 | 7.5 | 7.0 | XB-02 |
| 4 | Call graph | 5.5 | 7.0 | 6.0 | 6.5 | XA fixed, B/C added; new XB-02..06 |
| 5 | CFG | 7.5 | 7.5 | 7.5 | 7.5 | Not re-probed |
| 6 | DFG / taint | 5.0 | 7.0 | 6.0 | 5.5 | XB-01 (old gap, newly found) |
| 7 | Frameworks | 4.0 | 4.0 | 4.0 | 4.0 | — |
| 8 | Determinism | 8.5 | 9.0 | 9.0 | 9.0 | Re-verified |
| 9 | Scale | 6.5 | 8.0 | 7.5 | 7.5 | Not re-measured |
| 10 | Testing | 7.0 | 8.5 | 7.5 | 7.5 | Oracles up; arrow-helper taint gap not covered |
| 11 | Docs / governance | 5.0 | 7.0 | 6.5 | 6.5 | XA-07 fixed; XB-03, XB-05 wording; CI down |
| | **Overall** | **≈ 67** | **≈ 77** | **≈ 72** | **≈ 70** | |

The lower overall score is not a regression of the code since XA: every XA finding is fixed and B1–C2 add real
coverage. It comes from XB-01, a long-standing taint gap (present on `d30ffaa`) that earlier audits did not probe,
and from soundness holes in the newest resolution rules. None of XB-01..09 is in an earlier report (checked against
the 28 Oct findings, the 8 Nov and 9 Nov reports, PHASE-C-DESIGN and ENGINE-PLAN-TO-88).

## 6. Suggested fix order

1. **XB-01**: summaries for arrow functions and function expressions (and the caller label). Largest effect on
   what the product claims (taint). Expect many new flows on corpora: the fact diff will show gains, not losses.
2. **XB-04**: use the shared binding/rebinding check in C1 (small, removes false RESOLVED).
3. **XB-02**: resolve `#imports` and self-references through `package.json` before calling a specifier a package.
4. **XB-03**: count writes through an alias of a global, built-in prototype or package, and same-file
   `Object.assign`/`defineProperty` onto them.
5. **XB-05, XB-06, XB-07** (small, C1/C2 rules), then XB-08 wording. XB-09 needs the owner (billing).
