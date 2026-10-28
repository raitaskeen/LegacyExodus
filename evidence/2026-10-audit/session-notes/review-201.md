# PR #201 (F-003) — independent red-team review

Reviewed 2026-10-28 on the new machine (Windows 11, Bun 1.4.4, Git 2.56). Reviewer did not author the candidate.
Candidate treated read-only; all execution in isolated copies under `C:\Projects\.f003-review`.

## CANDIDATE

- Base `af48a64b58046f61adf97531937f2fe60c3d7d93`; candidate `7153b83ee2c45624e503b30d0b2b1f7bfae627e6` (one commit).
- Complete diff: 7 files, +742/−30. Source: `src/flow/control-flow-builder.ts` only (+49). Tests: 4 changed, 2 new
  (`loop-header-isolation.test.ts`, `unreachable-predecessor-dominators.test.ts`). No untracked content.
- Delivery state after review: branch updated onto `main` by merge commit `900666b` (tree `e2f42b4`, identical to the
  verified merge tree). `main` = `35312b9` did not touch `src/flow` or `tests/unit/flow` since base.

## Evidence

| Check | Revision | Result |
|---|---|---|
| RED: candidate tests on base source | af48a64 + candidate tests | 27 fail / 466 pass (23 F-003 + 4 dominator; do-while control passes) |
| GREEN: flow suite | 7153b83; main+PR | 493 / 493 pass on both |
| `bun run verify` main+PR (git worktree, merge tree e2f42b4) | 447c549 (local only) | typecheck 0 errors; 1800 pass / 0 fail, 150 files; audit 10/10; diff --check clean |
| `bun run verify` control | 35312b9 | typecheck 0; 1779 pass / 0 fail, 148 files; audit 10/10; clean |
| Delta | — | +21 tests / +2 files = exactly the candidate's new tests; no other change |
| `git diff --check af48a64 7153b83` | — | exit 0 |
| Merge onto main | merge-tree | clean, no conflicts |

Note: a first full run in a `git archive` copy showed 6 failures + audit 8/10, all `git rev-parse HEAD` / missing
discovery path — environment only (no `.git`); not reproduced in a real worktree.

## COUNTEREXAMPLES

None found. 25 adversarial programs (`probes/probe.ts`), checked against oracles written independently of the
candidate's tests: dominance by vertex removal + reachability, textbook natural loops from dominance back edges.

- Candidate: every reachable idom matches the oracle in 25/25; every real loop matches; entry never has incoming edges.
- Base: 17/25 fail (entry-with-incoming, missing idoms, merged/missing loops).
- Programs covered: continue via switch / try-finally / labelled targets, `for(;;)`, `for(;false;)`, `while(true)`
  with return, for-of/in with throwing iterable / member left, throwing update, labelled clause throws, loop first in
  try/catch/finally, nested and mixed do-while/for, unbraced bodies, multi-declarator init, `for await`, unreachable loops.

## UNCHANGED_BEHAVIOR

- Nothing in `src` reads CFG internals beyond persistence to `control-flow.json`; DFG/taint built independently
  (writer's corpus evidence: data-flow.json byte-identical on express/fastify; not re-run here).
- Exception attribution verified per clause: init/iterable → pre-loop block, test/left → header, update → update block.
  Base attributed all clauses to the shared header block.

## DETERMINISM

`probes/perf.ts`: 14,465 CFGs from 760 node_modules JS files (parsed only). First / reused-builder / fresh-builder
digests identical on candidate (`3ba88ac05c335ec5`) and base (`ca51d3115e9dc13c`).

## RESOURCE_EFFECT

Same graph count and loop count (1,088); blocks +2.4% (59,999 → 61,445); heap 245 → 249 MB. Timing inconclusive
(full suite ran concurrently); no algorithmic change — dominator loop adds an O(1) set lookup per predecessor.

## SCOPE

Diff matches the authorised cause: F-003 loop header isolation plus the dominator fix the human chose (option A),
each with its own RED test. No unrelated refactor.

## Test quality

Changed expectations (natural-loop-completeness I/L/M/N, CFG-01 T3, finally-cfg-precision T4, for-loop-reachability
T16/T17, flow-analysis labelled break/continue) are stricter, not weaker: they pin the exact update block, its single
`loop-back` to the header and its loop membership. Basis: ECMA-262 ForBodyEvaluation (continue → increment → test);
ForIn/OfHeadEvaluation evaluates the iterable once. No test deleted, skipped or loosened.

## Eleven probes

1. Assumptions: clause-once vs per-iteration semantics checked against the spec — hold.
2. Boundaries: see counterexample list; labelled loops keep pre-existing missing clause exception edges (A3).
3. Wrong-reason pass: oracles independent of candidate tests; RED reproduced.
4. Structural root cause: fixed (fresh header; separate update block; reachable-only predecessors in dominators).
5. Behaviour elsewhere: only control-flow.json changes; full suite green with no delta beyond new tests.
6. Determinism: unchanged (verified).
7. Resources: +2.4% blocks; no complexity change.
8. Error/uncertainty visibility: exception edges now more precise; none lost in probes.
9. Diff size: proportionate.
10. Docs: none required (writer's analysis); `.github/copilot-instructions.md:144` claim now true.
11. Toolchain: Bun 1.4.4 vs `packageManager` bun@1.4.2 — no effect observed.

## Adjacent findings (not defects of this candidate)

- A2 (known): dead tails after break/return still emit `loop-back` → spurious {header, tail} loops (3 probes; same on base).
- A3 (known): labelled loops get no clause exception edges (same on base).
- NEW: copied `finally` blocks repeat statement ids within one graph (`p02_labelled_finally`; same on base).

## VERDICT

**RED_TEAM_PASS.** Next boundary: human / Git governor for merge.
