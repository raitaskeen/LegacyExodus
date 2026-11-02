# Remediation queue and resume guide

The live plan for fixing the audit findings ([FINDINGS.md](FINDINGS.md)), plus the scale and storage
work the Ghost run showed is needed before the IR phase. This file is the hand-off point: a new
session resumes from here.

## Rules (owner decisions, 2026-10-28; updated 2026-11-02)

- **Branches:** `main` is the only truth; `core-foundation` and `docs-foundation` are retired (do not delete them without an explicit OK).
- **One finding per PR**, branch from the latest `origin/main` (or stack on an open PR that touches the same files), with the RED test committed or shown first.
- **File allowlist = lock:** no two running items touch the same file. The exception is `tests/conformance/known-gaps.ts`, where each fix edits only its own finding's group.
- **Parallelism:** at most 3 sessions or agents at once.
- **Who does the work (2026-11-02):** the owner asked for no subagents. The lead session writes, tests and self-reviews every item itself.
- **Merge gate:**
  - required checks green (Verify Core, Windows Path Smoke);
  - fact-diff with no unexplained lost facts;
  - each fix removes its own ledger entries;
  - owner decision (2026-11-02): with no subagents, merge on green CI. The lead self-reviews, and the fact-diff evidence goes in the PR. This replaces the independent red-team PASS. After each merge, confirm `origin/main^{tree}` equals the reviewed head's tree.

  Merge with `gh pr merge <n> --auto --squash --match-head-commit <sha>`. `main` requires up-to-date branches, so after another PR merges, merge `origin/main` into the waiting branch, push, and re-arm.
- **Red-team FAIL → Path A:** fix on the same branch, then send the fixed head back to the same reviewer. After two FAILs, go back to design.
- **Engine invariants (every item):**
  - Deterministic: byte-identical output across runs, code-point ordering, no wall-clock or locale in facts.
  - Proven-only: RESOLVED means proven, and an unknown stays visible as UNRESOLVED or REQUIRES_REVIEW, never absent.
  - Secure: no network during analysis, HMAC-bound snapshots, no plaintext paths in shared artifacts (BA-26).
  - Fast: no stage superlinear in file or function count.
  - No over-engineering: build only what a finding, a failing case or a measured budget demands.

## Status

| Wave | Item | Findings | Allowlist (lock) | Depends on | Status |
|---|---|---|---|---|---|
| 0 | Fact-diff tool | — | `benchmarks/fact-diff.ts`, `benchmarks/cli.ts`, its test | — | merged #204 `6c14e0d` |
| 0 | Code-point ordering | BA-16 | sort comparators in `src/**`, `src/shared/ordering.ts` | — | merged #205 `9b31888` |
| 0 | Truth-label reset | BA-21, BA-22, BA-08 label | `README.md`, `docs/CURRENT_IMPLEMENTATION.md`, route state + test | #205 | merged #207 `5a95e9f` |
| 0 | Conformance corpus + ledger | BA-20 (1) | `tests/conformance/**` | #204 | merged #206 `5ba1e21` |
| 1 | Parser dialect per extension | BA-01 | `src/parser/adapters/javascript/**`, parser tests, BA-01 ledger group | #206 | merged #210 `24c3d3b` |
| 1 | CFG adjacents (A2, A3, `finally` ids) | BA-14 | `src/flow/control-flow-builder.ts`, CFG tests, BA-14 ledger group | #206 | merged #211 `d7e51f1` (after one FAIL on nested `finally` ids; fixed by collision-free probing). Lead decisions: keep dead-tail `loop-back`; loops wholly in dead code are not natural loops |
| 1 | CI fact-diff job (PR summary of facts lost/gained) | BA-20 | `.github/workflows/ci.yml`, workflow tests | #204 | merged #208 `5ef17de` |
| 1 | Pin corpora by commit and tree hash | BA-20 (2) | `benchmarks/corpus/**`, `tests/unit/governance/test-fidelity-helpers.ts` | — | merged #212 `57aaa52` |
| 1 | Harden conformance (#206 review) | BA-20 (3) | `tests/conformance/cases.ts` | #206 | merged #209 `0ffd0c2` |
| 1 | Parser fallback honours `language: typescript` for unlisted extensions (#210 review; unreachable in production today) | BA-01 | `src/parser/adapters/javascript/**` | #210 | queued (small) |
| 1 | Fact-diff residual gaps (dominators, lifetimes, unused definitions, first taint hop) | — | `benchmarks/fact-diff.ts` | #204 | queued (low) |
| 2 | TS module resolution | BA-03 | `src/graph/**`, tsconfig loader, `command-handler.ts` aliases | Wave 1 | merged #213 `bbf10ce` |
| 2 | TypeScript declarations | BA-02 | symbol extractor, `symbol-contracts.ts`, kind lists in `src/` | Wave 1 | merged #214 `56acd69` (after one FAIL: specifier exports, regex, reopened-namespace soundness) |
| 2 | Docs truth update after BA-02 and BA-03 | BA-21 follow-up | `README.md`, `docs/CURRENT_IMPLEMENTATION.md` | #213, #214 | merged #215 `de960f7` |
| 2 | Class expressions; switch and static-block scopes | BA-13 | symbol extractor, call graph | BA-02 | merged #216 `1a55f86` (after one FAIL: Annex B target, class-expression dead code) |
| 2 | Namespace imports | BA-09 | `dependency-graph-builder.ts`, `semantic-engine.ts`, `module-resolver.test.ts` | #216 | merged #217 `6a15716` |
| 2 | Compiled CommonJS | BA-12 | symbol extractor (`void 0`), `call-graph-builder.ts` | #217 (stacked) | merged #218 `16c51ec`. Follow-up: getter re-exports, `__exportStar`, `__importDefault`/`__importStar` interop |
| 2 | Dynamic `import()` and computed loads | BA-10 | module-reference and graph contracts, extractor, graph builder, semantic engine, `fact-diff.ts` | #218 (stacked) | merged #219 `7210e8d`. Follow-up: literal `require('./x')` in expression position |
| 2 | Follow-ups: `.d.ts` implicit exports; surface tsconfig diagnostics; namespace calls through aliases; `profile.ts` alias reader | BA-02, BA-03 | per item | #213, #214 | queued |
| 3 | Data flow rebuilt on the CFG; design in WAVE3-DFG-DESIGN.md (steps 3a–3d) | BA-05, BA-04, BA-06, BA-27, BA-28 | 3a: `control-flow-builder.ts` (`buildAllWithNodes`), new `cfg-dataflow.ts` | design done | 3a merged #220 `041ccee` (core not wired in; fact-diff 0/0). Next 3b: wire into `buildContext` with `bindingOf` from lexical scopes, closures may-only, catch parameter definition; expect taint gains and lost `join` definitions |
| 3 | Taint policy packs | BA-07 | flow policy module | DFG rebuild | queued |
| S | Scale and storage track (from the Ghost run, below) | BA-17, BA-28, new | per item | see track | queued; S1 rides with 3d |
| 4 | Express model; dead-code precision; React; discovery policy | BA-08, BA-11, BA-24, BA-15 | semantic modules; `src/discovery/**` | Wave 3 | queued |
| 5 | Stable identity (ADR first) | BA-18 | ids | Wave 4 | queued; required before IR |
| 5 | Manifest location without plaintext path | BA-26 | `src/storage/projections/**`, `src/discovery/discovery-validator.ts`, `snapshot-trust.ts`, tests | Wave 4 | queued. Design (lead, 2026-10-28): the validator binds reuse to the canonical absolute path (`discovery-validator.ts:280, :405`, the F-001 location binding), so a relative path alone would weaken trust. Replace `repository.path` with `repository.locationDigest = HMAC(localKey, canonicalPath)`, recomputed on validate, and bump the manifest contract so old snapshots refresh |
| Docs | Docs/governance session (incl. remaining `core-foundation` mentions in GOVERNANCE, CONTRIBUTING, PR template, `.agents`) | BA-23, BA-22 rest | `docs/**`, root docs, `.agents/**` | anytime | queued |

## Scale and storage track (Ghost run, 2026-10-29)

Measured on TryGhost/Ghost:
- 9,168 files discovered, 7,202 analyzed, 0 parse failures;
- about 26 min wall time, about 10.2 GB peak RSS, 1.6 GB projected output;
- 18% of calls resolved;
- only 17,872 of 47,644 imports are relative; most of the rest are `@tryghost/*` workspace packages that never resolve.

Each item is the smallest change that moves a measured number. Every one keeps output byte-identical except where the item says otherwise.

| Step | Change | Budget / gate | Findings |
|---|---|---|---|
| S1 | Ghost pinned as a benchmark (commit and tree hash, like the other corpora). The stage timer and peak RSS are recorded in the benchmark report | Baseline recorded; from then on a run may not regress time or RSS by more than 10% | BA-28 |
| S2 | Linear-cost data flow (Wave 3a–3b persistent state, no per-`if` scope copies) | Stage doubling ratio ≤ 2.5× at 1k→2k→4k functions | BA-28, BA-05 |
| S3 | Workspace package resolution: read `workspaces` (npm/yarn) and `pnpm-workspace.yaml`, then map package names to their source roots via each package's `exports`/`main`/`types`. No network, no `node_modules` crawling | Ghost import bindings rise from 37.5% relative-only; the fact-diff gains are explained | new (coverage) |
| S4 | Streamed, per-file sharded output. Write each file's facts when the file is done and drop its AST. The project-level indexes are built from shards, and the HMAC manifest covers shard digests | Peak RSS bounded by the largest file plus the indexes, not the repository. Target for Ghost: under 3 GB | BA-17 |
| S5 | Compact storage. Minified JSON shards. The knowledge graph references symbol ids instead of duplicating symbol records. Projections written once, not re-serialized | Ghost output under 400 MB with no fact lost (fact-diff 0/0) | BA-17 |
| S6 | Incremental runs: a shard keyed by content hash plus engine and config version is reused when unchanged, and invalidation follows the module graph | Second Ghost run with one file changed in under 10% of the full run; output byte-identical to a clean run | new (speed) |
| S7 | Parallel per-file stages (parse, symbols, CFG) on a bounded worker pool, merged in code-point order | Wall time scales with cores; outputs byte-identical to a single worker (CI check) | new (speed) |

Order: S1 with 3d; S2 is Wave 3; S3 after Wave 2 merges (it touches `src/graph/**`); S4 and S5 together after Wave 3; then S6, then S7. BA-18 (stable identity) lands before S6, since cache keys and IR units need edit-stable ids.

## Road to IR, migration and new languages

1. **Finish Waves 2–5 and the S track.** Exit criteria for the IR phase:
   - every P0/P1 finding fixed;
   - the conformance ledger is empty, or each remaining entry has an owner decision;
   - stable identity (BA-18) is in;
   - Ghost runs within its S budgets;
   - two runs are byte-identical.
2. **IR phase.** A language-neutral IR built from the proven facts only (symbols, module graph, proven calls, CFG/DFG). Each IR unit carries its evidence state, and unknowns stay explicit. The IR gets its own conformance cases and fact-diff category before any migration code is written.
3. **Migration.** Plans are generated from the IR, with ordering from the module graph and cycles, and verified by running the target's tests. Every plan step is traceable to IR evidence.
4. **New languages (PHP, Ruby on Rails, Java).** Each language enters through the existing adapter seams (parser adapter, symbol extractor, resolver) and gets its own conformance corpus and pinned real-world benchmark. It is not "supported" until its ledger is empty and its benchmark meets budgets. No language-specific logic goes into the IR or migration layers.

Notes:
- BA-03 design question: TS importers now resolve to a `.d.ts` sibling over `.js` (TS semantics), which drops runtime call/data-flow facts through that import (pino `test/helper.js`). Consider linking the declaration to its implementation for runtime analysis. Also: surface `getTsConfigDiagnostics()` to users; read `allowJs`.
- Corpus pinning residual (accepted): a `benchmarks/.cache` entry whose name matches no manifest is skipped, not refused. Consider failing closed on unknown entries. A half-cloned cache (no `HEAD`) fails the pinned-tree check; delete that cache folder and rerun.
- Lead decision (2026-10-28): the hotspot split is dropped. Wave 2 items lock disjoint files, so splitting adds risk without enabling parallelism.
- BA-01 known limitation: with the Flow plugin, a statement that is only the identifier `type`, `declare` or `opaque` at the end of a line, followed by an assignment on the next line (valid JS via ASI), now misparses as Flow. No corpus hits it. Revisit if a real repository does.
- BA-03: since #205 the generic `paths` alias `@/*` beats `@/_internal/*`. ICU order matched tsc's longest-prefix rule only by accident. Implement longest-prefix selection.
- BA-09 design: references carry no member-access context, so every export a namespace object exposes counts as used (sound). Precise member tracking is a possible later refinement under BA-11.

## How to resume (new session or after a usage limit)

1. `git -C C:\Projects\LegacyExodus fetch origin`, then read this file on `origin/audit/2026-10-28-blind-audit`.
2. `gh pr list --repo raitaskeen/LegacyExodus --state open` shows in-flight PRs. No PRs are open after #220 (2026-11-03). Next item: Wave 3b.
3. When an item merges, mark it here (commit to the audit branch) and start the next queued item whose dependencies are merged.
4. Ledger check: `bun test tests/conformance` on `main` must pass, and `known-gaps.ts` lists exactly the open findings.

## PR template

```
Wave <n> of the audit remediation (audit: #203), finding <BA-xx>.
**Problem** <one paragraph from FINDINGS.md>
**Change** <what and where>
**Evidence** RED on main (test + failing output) · GREEN · full suite (pass/fail/files) ·
typecheck · benchmark audit · conformance (ledger entries removed) · fact-diff main→head on
corpora (lost/gained with explanation)
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```
