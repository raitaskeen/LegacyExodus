# Independent red-team re-review (round 2): PR #200 (F-002)

**VERDICT: RED_TEAM_PASS** (basic depth): all 24 round-1 counterexamples are closed, no new counterexample was found, and all gates pass.

Basic-depth re-review of the fix for the round-1 RED_TEAM_FAIL (`review-200.md`). Reviewer: independent session `review-200-efbe81` (not the author). Date: 2026-10-27.

## Candidate

| Item | Value |
|---|---|
| Head (live `gh pr view 200`) | `ca568f29a62cbedb0d52ab4a7d6abda73ae185c4`: matches the requested head |
| Base | `af48a64b58046f61adf97531937f2fe60c3d7d93` |
| New since round 1 | one commit, `ca568f2` on top of `efe425a` |
| Files changed by `ca568f2` | `call-graph-builder.ts` (+369/−56 incl. tests below), `call-resolution-soundness.test.ts` (+403), `call-graph-scaling.test.ts`, `fastify-ground-truth.ts` |
| Untracked content | none; review worktree clean, detached at `ca568f2` |

## 1. My probe set against `ca568f2`

All round-1 probe directories (`probes/*`, `flips/*`, 45 programs) were rerun with the same harness: `CORE_DIR=<worktree>/legacy-exodus-core bun harness/probe.ts probes/* flips/*`.

- **Result: 1 flag**, the q02 `loop` line. **Confirmed as a harness artifact**: the flagged call is `new B()` on the marker line; it resolves to class `B`, which is correct. My harness can't map constructor labels.
- **All 24 round-1 counterexamples are closed.** p01–p16, p28–p32 and p29 are now UNRESOLVED. p20 now resolves `h` to the local function `h`, which is the function that runs. p27 no longer records a named call (computed key no longer resolved), so it makes no RESOLVED claim.
- The excused static-vs-instance case (q04) and the getter case are now UNRESOLVED too.
- Precision controls still RESOLVED and correct: p00 const, q02 before/after rewrite, q03 `this.#p` / `C.s` / `d.m`, q07 fresh `Object.assign` and computed keys.
- Every flipped-expectation and express-relabel probe stays UNRESOLVED.

## 2. RED and GREEN for "independent review counterexamples"

- The block has 35 tests: 28 counterexamples + 7 controls.
- **RED**: the `ca568f2` test file was run against `efe425a` source in an isolated export: **28 fail, 99 pass**. All 28 failures are inside the new block, none elsewhere in the file.
  - 27 fail in the `unproven` helper: a call on the marked counterexample line was RESOLVED on `efe425a`.
  - 1 fails in `resolvedOn` (the p20 shape): `efe425a` resolved `h` to `helper.js`'s export instead of the local `h`.
  - All failures are for the stated reason.
- The 7 controls pass on `efe425a`.
- **GREEN**: on `ca568f2` the file has **127 pass, 0 fail**.

## 3. Gates at `ca568f2`

| Gate | Result |
|---|---|
| `git diff --check af48a64` | PASS (clean) |
| typecheck | PASS |
| `bun run test` (`benchmarks/.cache/*/.discovery` deleted first) | **PASS: 1741 pass, 1 skip (pre-existing win32 skip), 0 fail**, 1742 tests in 146 files; `call-graph-builder.ts` 100% lines |
| `bun run benchmark audit` | PASS 10/10 (Engine SHA `ca568f2`) |
| CLI `--help` | PASS |

No out-of-memory or spawn failures occurred; no reruns were needed.

## 4. The two changed expectations

| Change | Judgement | Evidence |
|---|---|---|
| `call-graph-scaling.test.ts`: two imports sharing a name now UNRESOLVED (was: first-match `export:first`) | **Justified**: the old expectation was unsound | Probe r00: `var shared = require("./first.js"); var shared = require("./second.js"); shared()` runs `second`; the engine now says UNRESOLVED. The first-match RESOLVED would have been wrong |
| fastify `gt-call-route-addNewRoute` relabelled UNRESOLVED | **Justified as conservative precision loss** | `lib/route.js` (fastify 5.3.3) calls only `addNewRoute.call(this, …)` (lines 230–247) and has 7 computed-key writes (e.g. `context[kReplySerializerDefault] = …`, line 357). At runtime those keys are Symbols, so the builtin `call` runs, but the engine can't statically rule out a write that names `call`. UNRESOLVED loses precision without unsoundness. `fastify-fidelity.test.ts` and `express-fidelity.test.ts` are not in the diff, so **no threshold changed** |

## 5. New probes against the new rules (`probes2/`)

| Probe | Shape | Engine | Runs | Result |
|---|---|---|---|---|
| r01 | `static m()` + `static ["m"] = fn` | UNRESOLVED | field | sound |
| r01 | `["n"] = () => …` + `n()` | UNRESOLVED | field | sound |
| r01 | plain method control | RESOLVED `P.q` | `P.q` | correct |
| r02 | class-expression self name `Self.t()` shadowing an outer `class Self` | UNRESOLVED | inner `t` | sound |
| r02 | `Own.u()` via an unshadowed class-expression self name | UNRESOLVED | `Own.u` | sound; precision loss only |
| r03 | strict block function in a switch case, `g()` after the switch | RESOLVED outer `g` | outer `g` | correct |
| r03 | `var y` in `static {}`, outer `y.m()` | UNRESOLVED | `A.m` | sound (conservative) |
| r03 | switch with an unrelated `let`, `z.m()` | RESOLVED `A.m` | `A.m` | correct |
| r04 | import `f` with a nested local `function f` elsewhere | RESOLVED import | import | correct |
| r04 | block `const f` shadowing an import | RESOLVED block `f` | block `f` | correct |
| r04 | switch-case `const f2`, then `f()` in the case | RESOLVED import | import | correct |
| r05 | `g.bind = …; g.bind(null)()` | UNRESOLVED | own `bind` | sound |
| r05 | `h[key] = …` (key `"call"`); `h.call()` | UNRESOLVED | computed `call` | sound |
| r05 | clean `f.call`/`apply`/`bind` in a file that also has those writes | UNRESOLVED | `f` | sound; file-wide caution |
| r06 | `f.call`/`apply`/`bind`, `a.m.call` in a write-free file | RESOLVED | same | correct; precision kept |

**0 mismatches** across 18 call sites.

## Observations (non-blocking)

- Precision costs as designed. Any write naming `call`/`apply`/`bind`, or any dynamic computed write, makes every `.call`/`.apply`/`.bind` call in that file UNRESOLVED (r05). The fastify relabel is one such cost. Class-expression self-name calls are no longer resolved (r02 `Own.u`). These lose precision only and are allowed by the contract.
- Static-vs-instance and getter cases from round 1's adjacent list now come out UNRESOLVED.
- Scope of this re-review is basic depth: the round-1 probe set, the new describe block, gates, the two expectation changes, and 7 new probe programs. I did not repeat the full round-1 hunt for new root-cause classes, the #198 merge interplay (`ca568f2` changes no orchestration file), or performance measurement.
- `~/.legacy-exodus/snapshot-hmac.key` was not read or touched.

## Evidence

- `review-200-evidence/logs/r2-*.log`: round-2 logs (probes, RED, gates).
- `review-200-evidence/probes2/`: the new probe programs.

## Compact handoff

- TASK_ID: review-200 round 2
- CANDIDATE: `ca568f2` (base `af48a64`)
- FILES_CHANGED: none (read-only)
- TEST_RESULTS: all gates PASS; 0 soundness mismatches (1 confirmed harness artifact)
- VERDICT: RED_TEAM_PASS (basic depth)
- NEXT_AUTHORIZED_ROLE: human / Git governor for the authorized merge sequence (#198, then #200)
