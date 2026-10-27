# Independent red-team review — PR #200 (F-002)

**VERDICT: RED_TEAM_FAIL**: Path A (implementation), with a design hand-off for the scope-model part (see "Required next boundary").
#200 must not be merged as an F-002 acceptance on this evidence.

Reviewer: independent session `review-200-efbe81` (not the author). Date: 2026-10-24.

## Candidate

| Item | Value |
|---|---|
| PR | #200 `fix(semantic): only resolve calls whose target is proven (F-002)` |
| Head (live `gh pr view 200`) | `efe425ac7573c12edbdcd813746e700c93f2aa16`: matches the frozen candidate |
| Base | `main` `af48a64b58046f61adf97531937f2fe60c3d7d93` (merge-base identical) |
| Commits | `7424525`, `0c556c8`, `0e13553`, `efe425a` |
| Diff | 13 files, +1615/−137. Source: `call-graph-builder.ts`, `semantic/index.ts`, `command-handler.ts`, `express-ground-truth.ts`, plus tests |
| Untracked content | none (the PR is committed content only; review worktree clean at `efe425a`) |
| #198 | head `140ec833dea0ee2abe9812f3b16a3af67ee8c4c2` (live), base `af48a64` |

## Gate results

| Gate | SHA / tree | Result |
|---|---|---|
| RED 7424525 tests on `af48a64` | src af48a64 / tests 7424525 | 17/31 fail, all "Expected UNRESOLVED, Received RESOLVED": **reproduced** |
| RED 0c556c8 tests on `7424525` | | 22/61 fail (21 counterexamples, plus the nearest-block-class precision control) — **reproduced** |
| RED 0e13553 tests on `0c556c8` | | 11/78 fail (10 counterexamples + exported-class control): **reproduced** |
| RED efe425a tests on `0e13553` | | 10/92 fail: **reproduced** |
| typecheck | efe425a | PASS (tsc 7.0.2 strict, src+tests) |
| full suite (`.discovery` cleared) | efe425a | PASS: 1706 pass, 1 skip (pre-existing win32 skip in `init.test.ts`), 0 fail; `call-graph-builder.ts` 100% lines |
| `benchmark audit` | efe425a | PASS 10/10 |
| CLI `--help` | efe425a | PASS |
| `git diff --check af48a64` | efe425a | PASS (clean) |
| Local merge #198 → #200 | HEAD 140ec83 + MERGE_HEAD efe425a, staged tree `73685ee6eb866b673a93ddcdc4714a653e7672d6` (= `git merge-tree`), conflict-free | typecheck PASS; suite **1731 pass, 1 skip, 0 fail**; audit 10/10; `--help` PASS. Merge was uncommitted and aborted afterwards |
| Snapshot saved by #198 alone | `LEGACY_EXODUS_HOME` isolated in scratch | #198 run 1 fresh, run 2 reused (positive control). Merged run: `reused:false`, analyzer `8676af17…`→`1ec3b093…`, `this.handle` RESOLVED→UNRESOLVED (reanalyzed). Merged run 2 reused. **PASS** |
| Thresholds | | unchanged (`express-fidelity` / `fastify-fidelity` tests not in diff; benchmarks diff = 5 labels + comments) |
| Determinism | efe425a, separate processes | identical call digests across runs (express `b7b32d95…`, fastify `b7faf893…`) |
| Differential soundness (contract) | efe425a | **FAIL: 24 counterexamples** |

An earlier run of the merged tree from a scratch export failed 8 tests. These were ENVIRONMENT_FAILUREs: `SQLITE_CANTOPEN` from the Windows path length, and missing repository-root `.github` files. The run in the worktree is the authoritative one.
`~/.legacy-exodus/snapshot-hmac.key` was never read or deleted (32 bytes, mtime unchanged before and after).

## Counterexamples (FAIL)

Each program was executed with `bun` (1.4.2). The function that actually ran was recorded via printed labels and compared with the engine's RESOLVED target, using the same pipeline as the regression suite's `analyze()`.
None of the causes is in the PR's "Known limits / assumed not to happen" list.
"Base" is the result on `af48a64`.

| # | Program shape (abridged) | Engine RESOLVED target | Function that runs | Base | Root cause |
|---|---|---|---|---|---|
| p01 | `class C { constructor(){ return impostor } m(){} }; const c=new C(); c.m()` | `C.m` | `impostor.m` | same | RC1: `new C()` assumed to yield a C instance |
| p02 | base-class constructor returns an object; `new C().m()` | `C.m` | `impostor.m` | same | RC1 |
| p03 | `class C { m = make(); m(){} }; new C().m()` | `C.m` | field function | same | RC2: class fields are not counted as property writes |
| p04 | `class Base { m = () => … }; class C extends Base { m(){} }` | `C.m` | `Base` field | same | RC2 |
| p05 | `f.call = evil; f.call(null)` / `A.prototype.m.apply = evil; a.m.apply(a)` | `f` / `A.m` | `evil` | same | RC3: `.call/.apply/.bind` unwrap ignores own properties |
| p06 | `class C { make(){ return { toString(){…} } } }; c.toString()` | the literal's `toString` | `Object.prototype.toString` | same | RC4: object-literal methods inside a class body are attributed to the class |
| p07 | the same, with `Base.only`; `c.only()` | the literal's `only` | `Base.only` | same | RC4 |
| p08 | class expression inside a class method; `o.only()` | the expression's `only` | `Base.only` | same | RC4 (class expressions) |
| p10 | `switch(k){ case 0: const x=new B(); }` then `x.m()` after the switch | `B.m` | `A.m` (outer x) | same | RC5: switch case blocks are not scopes |
| p11 | `switch(k){case 0: let f=1;} f = () => …` (writes the module `f`); `f()` | `decl f` | rewritten | same | RC5 |
| p12 | `class K { static { const x = new B() } }`; global `x.m()` | `B.m` | `A.m` | same | RC5: static blocks are not scopes |
| p13 | `var x=new A(); function f(g = () => x.m()) { var x = new B(); g(); }` | `B.m` | `A.m` | **base OK: regression** | RC5: parameter scope vs body `var` |
| p14 | `const g = function f(n){ … f(0) }` with an outer `function f` | outer `f` | inner `f` | same | RC5: named function expression name |
| p15 | `const K = class C { static make(){ return new C() } }` with an outer `class C` | outer `C` | inner `C` | same | RC5: class expression name |
| p16 | `const K = class Inner { #m(){} go(){ this.#m() } }` with an outer `class Inner { #m(){} }` | declaration's `#m` | expression's `#m` | same | RC5: private `this.#m()` |
| p20 | `function h(){}`; `function lazy(){ const h = require('./helper') }`; `h()` | helper's export | local `h` | same | RC6: a function-local `require` becomes a module-wide import |
| p27 | `const k="m"; function run(){ x[k](); var k="zzz"; }` | `A.m` | `A.undefined` | same | RC7: constant key lookup ignores a hoisted `var` |
| p28 | `(x as any) = new B()` / `y! = new B()` in `swap()`; then `x.m()` | `A.m` | `B.m` | same | RC8: TS assignment targets missed by the write collector |
| p32 | `constructor(private svc){ svc.m(); svc = new A(); }` called with `new B()` | `A.m` | `B.m` | **base UNRESOLVED: regression** | RC8: TS parameter property not recorded as a write |
| p29 | `@replace m(){}` decorator returns another function | `C.m` | decorated | same | RC9: decorators not modelled |
| p30 | `const app = make(); app.init ??= f; app.init()` | `f` | `make().init` | same | RC10: logical assignment treated as an unconditional definition (efe425a's own rule) |
| p31 | the same with `\|\|=` | `f` | `make().init` | same | RC10 |

Count: 24 call sites (p05 and p28 each have 2).
Production confirmation: running `legacy-exodus analyze --json --storage-driver memory` on p01/p05/p10/p16/p20 gives these calls as RESOLVED in `.discovery/semantic.json`, bound with the same wrong target in `data-flow.json` `callBindings`.

Taint consequence: in the p20 shape with `h(cmd){ child_process.exec(cmd) }` and `h(req.body.name)`, the control reports the `req.body.name → child_process.exec` flow. Adding the never-called `lazy()` with a local `require` retargets the call to `helper.js`, and the injection flow disappears (1 → 0 taint flows). This is a false negative.

Why this invalidates the candidate: the contract says a call is RESOLVED only when its target is provable under the listed assumptions. The PR states "A call is now RESOLVED only when its target is provable" and that "the only remaining wrong RESOLVED results are the assumptions listed under Known limits". Both claims are CONTRADICTED.
- Two cases are regressions the PR introduces: p13 and p32. Its new "written exactly once" receiver rule trusts incomplete write and scope evidence.
- Two are holes in the PR's own new definition-before-call rule: p30 and p31.
- The rest are pre-existing on `main` and not fixed.

## Unchanged and fixed behaviour (verified)

- **Sound under the PR (UNRESOLVED as required), each with a runtime counterexample:** parameter, block and catch shadowing; alias receivers; alias prototype and container writes; loop, closure, switch and labelled writes; `Object.assign`, `defineProperty` with a constant key, `Reflect.set`, `setPrototypeOf`; function constructors; inherited methods; CJS `module.exports` replacement or detachment, `Object.assign(module.exports)`, importer patches; ESM live `export default function` (p25) and `export *` (p26). p25 and p26 were wrong on base, so the PR fixes them.
- **Precision controls still RESOLVED and correct:** const or new receivers, straight-line before and after a rewrite, `this.#p()`, static `C.s()`, own derived method, fresh-object `Object.assign`, computed `c[k]()` and `c["m"]()`.
- **Flipped expectations and express relabels:** every one has a real runtime counterexample (borrowing via `.call`, subclassing an exported class, or a mixin target).
  - Base engine claimed these targets as RESOLVED and the runtime bypassed them (16 mismatches): SEM-08 S3–S6, receiver-resolution contextual `this`, Case A3, dynamic S5, the `semantic-engine` invoke test, golden `this.handle`, and models of `gt-call-app-lazyrouter`, `-default-config`, `-router-route`, `-res-set`, `-res-get`, using express's exported `application`, `response` and `Router`.
  - The relabels are justified, and no threshold changed.
  - G5 and the bind test keep their intent with private methods.

## Eleven probe questions

1. **Wrong assumption?** That the write and scope evidence is complete. Fields, constructor returns, TS targets, decorators, `.call` own properties, and the extractor's scopes and containers all break it.
2. **Missing cases?** switch, static block, parameter scope, named expressions, class fields, logical assignment.
3. **Test passes for the wrong reason?** No test was found to pass for the wrong reason. The regression suite covers only the shapes the author found.
4. **Root cause fixed?** Partially. The structural cause, proofs over incomplete binding and member models, remains.
5. **Valid behaviour changed?** Yes: p13 and p32 regress from correct (or conservative) results to a wrong RESOLVED target. Expected precision loss is otherwise as documented.
6. **Determinism?** Unchanged (identical digests).
7. **Resources?** Extra AST passes. On subsets, analysis takes about 1.4–2× base time with similar RSS (noisy, measured concurrently with other runs).
8. **Failure visibility?** Wrong targets stay invisible as RESOLVED, and they reach DFG and taint.
9. **Diff larger than needed?** No scope creep found. The `command-handler` change is needed for `unstableExportIds`.
10. **Documented claims accurate?** No: the PR summary and evidence claims are contradicted. The README docs impact is already declared.
11. **Toolchain or environment?** Bun 1.4.2 and tsc 7.0.2 are fine. The scratch-export failures were path-length environment issues.

## Adjacent issues (do not on their own invalidate)

- Known limit, excused: static vs instance is not distinguished. `class B{static m(){}} class C extends B{m(){}}; C.m()` resolves to `C`'s instance `m` while `B.m` runs. Getters are also not distinguished. Both are real soundness holes worth keeping visible.
- Unlisted assumptions that are not demonstrated as FAIL: indirect code evaluation (`new Function`, indirect eval) and script-mode global aliasing (`globalThis.x` vs a top-level `var`).
- Minor wording in the PR's RED description: one of the 22 failures on `7424525` is a precision control, not a counterexample.
- #198 merge interplay is confirmed correct (see the gates table).

## Required next boundary

- **Path A** (writer, `call-graph-builder.ts`):
  - RC1: constructor or base-constructor return.
  - RC2: class fields as property writes.
  - RC3: own `call`/`apply`/`bind`.
  - RC6: import lookup by binding scope.
  - RC7: hoisted constant shadowing.
  - RC8: TS write targets and parameter properties.
  - RC9: decorators.
  - RC10: logical assignment.
- **Design** (false scope boundary): RC4 (member attribution) and RC5 (switch, static-block, parameter and named-expression scopes) live in `javascript-symbol-extractor.ts` and the shared scope model. They need an expanded allowlist, or a human decision to list them as assumptions.
- Then: new RED proofs for each counterexample, and an independent re-review.

## Evidence

All under `review-200-evidence/` in this folder:
- `harness/probe.ts`: the differential harness.
- `probes/`, `flips/`: the programs.
- `logs/`: RED, GREEN, merged, snapshot, taint, base-vs-candidate and final-candidate logs.
- `red-run.sh`: RED reproduction.

To reproduce: `CORE_DIR=<legacy-exodus-core> bun harness/probe.ts probes/<name>`.

## Compact handoff

- TASK_ID: review-200 (F-002 red team)
- BASELINE_SHA: af48a64; CANDIDATE: efe425a; #198: 140ec83; merged tree 73685ee6
- BRANCH/WORKTREE: `.claude/worktrees/review-200-efbe81`, detached at efe425a, clean
- FILES_CHANGED: none (read-only; evidence only in this notes folder)
- TEST_RESULTS: all code gates PASS; contract differential FAIL (24 counterexamples)
- VERDICT: RED_TEAM_FAIL
- NEXT_AUTHORIZED_ROLE: writer (Path A) plus design (RC4/RC5); #200 merge blocked
