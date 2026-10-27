# F-003 loop header isolation — candidate hand-over (2026-10-24)

Writer session: friendly-swartz-d90320 worktree, branch `claude/friendly-swartz-d90320`,
base `af48a64b58046f61adf97531937f2fe60c3d7d93` (= origin/main at intake). Uncommitted. No push/PR.
Evidence folder: `f003-evidence/` next to this file (raw logs, scripts, corpus metrics).

## Root cause (CONFIRMED, reproduced)
`buildLoop` used `const header = block`: the loop statement node was appended to the block that already
held preceding statements, and `loop-back`/`continue` edges targeted it. For `for`, init/test/update were all
implicit in that single `ForStatement` node, so init looked per-iteration and `continue` skipped the update.
Base probe (`brief-predicates-base.log`): all five brief predicates false, graphs still `RESOLVED`.

## Change (src/flow/control-flow-builder.ts only)
- `buildLoop` creates a fresh header holding only the loop statement node (the test marker); pre-loop block
  gets `next` → header.
- once-evaluated clause node is appended to the pre-loop block: `for` init; `for-in/of` `right`.
- `for` update gets its own block: body tail `next` → update, update `loop-back` → header; it is the
  continue target (plain and labelled). No update → previous behaviour (`continue`/`loop-back` → header).
- potential-exception edges for header loops leave from the block that evaluates the clause
  (init/right: pre-loop; test/left: header; update: update block). Statement-level check skips header loops.
  Labelled loops keep their pre-existing behaviour (no clause exception edges) — see adjacent A3.
- do-while untouched (already enters a fresh body header).

## Tests
- New: `tests/unit/flow/loop-header-isolation.test.ts` (16 tests; 15 RED on base, 1 do-while control passes
  on base). Includes universal invariants: entry has no incoming edges; every `loop-back` target holds exactly
  one header-loop statement; determinism over fresh+reused builders.
- Existing expectations changed (EXPECTED_CHANGE, need independent review). All encoded the defective shape:
  - natural-loop-completeness Tests I, L, M, N, CFG-01 Test 3; finally-cfg-precision T4: `continue`/body
    completion of a `for` with an update now goes to the update block, which loops back to the header.
    Contract: ECMA-262 ForBodyEvaluation (continue completion → LoopContinues → IncrementExpression → test).
    Assertions are stricter (exact update target, update→header loop-back, update ∈ loop).
  - for-loop-reachability T16/T17: replaced the characterization "clauses live in the loop node; no
    UpdateExpression in any block" with: init only in entry, entry in no loop, exactly one update block,
    reachable, loops back to header, member of the loop.
  - flow-analysis "labeled break and continue": header located by the outer `WhileStatement` (was: by the
    `LabeledStatement`, which only shared the header because of the bug). Passes on base and candidate.
  - Pre-change candidate failures preserved: `existing-tests-on-candidate-before-expectation-change.log`.
  - Final RED (final test content vs git-archive of af48a64): `red-final-af48a64.log` — 23 fail / 465 pass.

## Gates on candidate v1 (no dominator fix; identity in f003-evidence/candidate-v1.identity)
- `bun run typecheck`: exit 0, zero errors.
- Flow subsystem `bun test tests/unit/flow`: 488 pass / 0 fail.
- Full `bun run test`: 1630 pass / 1 skip (pre-existing `skipIf(win32)` in tests/unit/cli/init.test.ts) /
  0 fail, 17681 expect() calls, 146 files (`full-test-candidate-v1.log`). Corpora were local copies of the main
  checkout's express/fastify/cookie-parser caches with every `.discovery` removed before the run.
- `bun run benchmark audit`: PASS 10/10 (`benchmark-audit-candidate-v1.log`).
- `git diff --check`: clean. Composite `bun run verify`: 4/4 PASS (typecheck, 1630 tests, audit 10/10,
  diff hygiene), exit 0. CLI `--help`: exit 0. Corpus determinism: 3 runs each, identical CFG/DFG digests.
- Tree: only the 5 modified test/source files + 1 new test file; all `.discovery` projections removed.
- Docs impact: NONE required. BENCHMARK_REPORT.md is a dated 2026-08-23 snapshot already out of step with
  base; CHANGELOG has had no per-fix entries since #79. `.github/copilot-instructions.md:144` ("unreachable
  blocks ... without corrupting dominator tree computation") is contradicted by base — supports option A.

## Corpus before/after (express, fastify; `corpus-compare-base-vs-candidate-v1.txt`)
- data-flow.json (DFG + taint) byte-identical; all projections identical except control-flow.json and
  manifest.json (run metadata).
- CFG: same graph ids, states, loop counts. Only graphs containing loops changed (36 / 100).
  Added block nodes = split clauses only (express: 27 VariableDeclaration, 29 UpdateExpression, 3 Identifier;
  fastify: 22/22 + 43 Identifier, 39 CallExpression, 7 MemberExpression iterables).
- entry-with-incoming 22→0 / 79→0; headers with extra statements 30→0 / 90→0 (63 / 595 extra statements);
  statements inside some loop 229→194 / 1013→446.
- Natural loops match an independent textbook oracle exactly on both corpora, base and candidate.
- Deterministic: two runs each, identical digests (`corpus-determinism.txt`).

## DECIDED (user chose A, relayed 2026-10-24): dominator fix included as candidate v2
- `calculateDominators(entry, blocks, edges, reachable)`: a reachable block ignores unreachable predecessors;
  unreachable blocks are computed as before. Source equals the measured prototype plus one comment line.
- New `tests/unit/flow/unreachable-predecessor-dominators.test.ts` (5 tests: abrupt loop tail, switch case
  tails, labelled continue below an abruptly exited inner loop, nested break, unreachable-block control; plus an
  independent textbook-dominator oracle over the reachable subgraph). RED: 4 fail / 1 control pass on candidate
  v1 (`red-dominators-candidate-v1.log`) and on af48a64 (`red-dominators-af48a64.log`).
- Synthetic oracle (`synthetic-oracle-v2.txt`): idom mismatches base 5, v1 11, v2 0; missing loop members 0.
- Gates on candidate v2 (identity `candidate-v2.identity`; 5 modified + 2 new files under src/flow and tests/unit/flow):
  - typecheck 0 errors; flow suite 493/493; full `bun run test` 1635 pass / 1 skip (pre-existing win32 skipIf)
    / 0 fail, 17766 expect() calls, 147 files (`full-test-candidate-v2.log`).
  - `bun run verify` 4/4 PASS incl. benchmark audit 10/10 and `git diff --check` (`verify-candidate-v2.log`);
    CLI `--help` exit 0.
  - Corpora base → v2 (`corpus-compare-base-vs-candidate-v2.txt`): data-flow.json + all other projections
    except control-flow/manifest byte-identical; same graph ids/states/loop counts; entry-with-incoming 22→0 /
    79→0; reachable blocks with wrong/missing idom 39→0 / 125→0; graphs changed 42 / 130 (36/100 with loops plus
    6/30 dominator-only corrections); natural loops match the oracle (`loop-dominator-oracle-v2.txt`).
  - Determinism: 3 runs per corpus, identical CFG/DFG digests; v2 CFG == measured prototype CFG.

## (history) dominator regression exposed by v1 (adjacent A1)
`calculateDominators` gives a block with no predecessors `dom = {self}` instead of ⊤, so a reachable block with
an unreachable predecessor (dead tail after break/continue/return in loop bodies and switch cases) loses all
dominators above it. Pre-existing: base has 39 (express) / 125 (fastify) reachable blocks whose idom differs from
the textbook one. Base headers that *were* the entry were immune; fresh headers are not, so the candidate adds
one: express `examples/route-map/index.js` for-in header (line 16) has no idom (should be the pre-loop block).
No natural-loop membership or DFG/taint change on corpora from this.
Prototype (benchmarks/.cache/f003-proto-a, scratch only): skip unreachable predecessors of reachable blocks
in `calculateDominators` → idom mismatches 0 on both corpora and synthetic set, loops unchanged, DFG identical,
dominators change in 9 / 31 graphs (all corrections). Options: (A) include it in this candidate with its own
RED test; (B) separate finding, ship F-003 with this documented regression.

## Other adjacent findings (not fixed)
- A2: loop/switch/do-while body tails that end in an abrupt completion still emit `loop-back`/`next` from the
  fresh unreachable block; yields spurious {header, dead-tail} "loops" (synthetic set: 3; corpora: 0).
- A3: labelled loops never get clause exception edges (buildLabeled bypasses the statement-level check).
- A4: do-while test: its exception edge leaves from the pre-loop block, and the condition block holds no node
  (DoWhileStatement sits in the pre-loop block) — relevant to F-004's CFG-derived DFG.
