# Remediation queue and resume guide

The live plan for fixing the audit findings ([FINDINGS.md](FINDINGS.md)). This file is the
hand-off point: a new session resumes from here.

## Rules (owner decisions, 2026-10-28)

- **Branches:** `main` is the only truth; `core-foundation` and `docs-foundation` are retired (do not delete them without an explicit OK).
- **One finding per PR**, branch from the latest `origin/main`, with the RED test committed or shown first.
- **File allowlist = lock:** no two running items touch the same file. The exception is `tests/conformance/known-gaps.ts`, where each fix edits only its own finding's group.
- **Parallelism:** at most 3 sessions or agents at once.
- **Model routing:**
  - The lead (Opus) writes specs, handles hard reasoning, integrates and merges.
  - Sonnet subagents act as writers on bounded specs and as independent red teams.
  - Haiku subagents do mechanical work: test hardening, bookkeeping, status checks.
- **Merge gate (standing auto-merge authorization):**
  - independent red team `VERDICT: RED_TEAM_PASS` on the exact head;
  - required checks green (Verify Core, Windows Path Smoke);
  - fact-diff with no unexplained lost facts;
  - each fix removes its own ledger entries.

  Then `gh pr merge <n> --auto --squash --match-head-commit <sha>`. `main` requires up-to-date branches, so after another PR merges, merge `origin/main` into the waiting branch, push, and re-arm.
- **Red-team FAIL ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ Path A:** fix on the same branch, then send the fixed head back to the same reviewer. After two FAILs, go back to design.

## Status

| Wave | Item | Findings | Allowlist (lock) | Depends on | Status |
|---|---|---|---|---|---|
| 0 | Fact-diff tool | ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â | `benchmarks/fact-diff.ts`, `benchmarks/cli.ts`, its test | ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â | merged #204 `6c14e0d` |
| 0 | Code-point ordering | BA-16 | sort comparators in `src/**`, `src/shared/ordering.ts` | ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â | merged #205 `9b31888` |
| 0 | Truth-label reset | BA-21, BA-22, BA-08 label | `README.md`, `docs/CURRENT_IMPLEMENTATION.md`, route state + test | #205 | merged #207 `5a95e9f` |
| 0 | Conformance corpus + ledger | BA-20 (1) | `tests/conformance/**` | #204 | merged #206 `5ba1e21` |
| 1 | Parser dialect per extension | BA-01 | `src/parser/adapters/javascript/**`, parser tests, BA-01 ledger group | #206 | merged #210 `24c3d3b` |
| 1 | CFG adjacents (A2, A3, `finally` ids) | BA-14 | `src/flow/control-flow-builder.ts`, CFG tests, BA-14 ledger group | #206 | PR #211 (head e41810c), in red team. Lead decisions: keep the dead-tail `loop-back` edge (two tests rely on it; the block is marked unreachable); loops wholly in dead code are no longer natural loops |
| 1 | CI fact-diff job (PR summary of facts lost/gained) | BA-20 | `.github/workflows/ci.yml`, workflow tests | #204 | merged #208 `5ef17de` |
| 1 | Pin corpora by commit and tree hash | BA-20 (2) | `benchmarks/corpus/**`, `tests/unit/governance/test-fidelity-helpers.ts` | ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â | queued |
| 1 | Harden conformance (#206 review): an `analyzed` companion for every `lacks` case; callee/state in `cjs:indirect-call-recorded`; taint state where it matters | BA-20 (3) | `tests/conformance/cases.ts` | #206 | merged #209 `0ffd0c2` |
| 5 | Manifest location without plaintext path | BA-26 | `src/storage/projections/**`, `src/discovery/discovery-validator.ts`, `snapshot-trust.ts`, tests | Wave 4 | queued. Design (lead, 2026-10-28): the validator binds reuse to the canonical absolute path (`discovery-validator.ts:280, :405`, the F-001 location binding), so a relative path alone would weaken trust. Replace `repository.path` with `repository.locationDigest = HMAC(localKey, canonicalPath)`, recomputed on validate, and bump the manifest contract so old snapshots refresh |
| 1 | Parser fallback honours `language: typescript` for unlisted extensions (#210 review; unreachable in production today) | BA-01 | `src/parser/adapters/javascript/**` | #210 | queued (small) |
| 1 | Fact-diff residual gaps (dominators, lifetimes, unused definitions, first taint hop) | ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â | `benchmarks/fact-diff.ts` | #204 | queued (low) |
| 2 | Split hotspot files (behaviour-preserving, fact-diff 0/0) | ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â | symbol extractor, `src/semantic/*` | Wave 1 | queued |
| 2 | TypeScript declarations, then class expressions, then dynamic import, then compiled CJS | BA-02, BA-13, BA-10, BA-12 | symbol extractor (serial chain) | split | queued |
| 2 | TS module resolution, then namespace imports | BA-03, BA-09 | `src/graph/**`, tsconfig loader, `command-handler.ts` aliases | Wave 1 | queued |
| 3 | Data flow rebuilt on the CFG | BA-05, BA-04, BA-06, BA-27, BA-28 | DFG modules | Wave 2 | queued |
| 3 | Taint policy packs | BA-07 | flow policy module | DFG rebuild | queued |
| 4 | Express model; dead-code precision; React; discovery policy | BA-08, BA-11, BA-24, BA-15 | semantic modules; `src/discovery/**` | Wave 3 | queued |
| 5 | Stable identity (ADR first); sharded output | BA-18, BA-17 | ids; projections | Wave 4 | queued |
| Docs | Docs/governance session (incl. remaining `core-foundation` mentions in GOVERNANCE, CONTRIBUTING, PR template, `.agents`) | BA-23, BA-22 rest | `docs/**`, root docs, `.agents/**` | anytime | queued |

Notes:
- BA-01 known limitation: with the Flow plugin, a statement that is only the identifier `type`, `declare` or `opaque` at the end of a line, followed by an assignment on the next line (valid JS via ASI), now misparses as Flow. No corpus hits it. Revisit if a real repository does.
- BA-03: since #205 the generic `paths` alias `@/*` beats `@/_internal/*`. ICU order matched tsc's longest-prefix rule only by accident. Implement longest-prefix selection.

## Paused 2026-10-28 (usage limit)

In flight when paused:
- #210 BA-01: red-team verdict pending.
- #211 BA-14: red-team verdict pending.
- Corpus pinning: Sonnet writer, branch `test/pin-corpora`, worktree `C:\Projects\.w1\pin`; check whether a PR exists.

On resume: for each, follow the checklist below. A missing verdict means re-running the red team on the PR head; a missing PR means re-running the writer from its row.

## How to resume (new session or after a usage limit)

1. `git -C C:\Projects\LegacyExodus fetch origin`, then read this file on `origin/audit/2026-10-28-blind-audit`.
2. `gh pr list --repo raitaskeen/LegacyExodus --state open` shows in-flight PRs. For each item marked "in progress", check its PR:
   - **No PR:** the writer was interrupted. Restart it from the spec in the PR template below and the finding text.
   - **PR without a red-team verdict:** start a Sonnet red team on its head.
   - **PASS and behind `main`:** merge `origin/main` into it, push, re-arm auto-merge.
3. When an item merges, mark it here (commit to the audit branch) and start the next queued item whose dependencies are merged, keeping at most 3 running.
4. Ledger check: `bun test tests/conformance` on `main` must pass, and `known-gaps.ts` lists exactly the open findings.

## PR template for writers

```
Wave <n> of the audit remediation (audit: #203), finding <BA-xx>.
**Problem** <one paragraph from FINDINGS.md>
**Change** <what and where>
**Evidence** RED on main (test + failing output) Ãƒâ€šÃ‚Â· GREEN Ãƒâ€šÃ‚Â· full suite (pass/fail/files) Ãƒâ€šÃ‚Â·
typecheck Ãƒâ€šÃ‚Â· benchmark audit Ãƒâ€šÃ‚Â· conformance (ledger entries removed) Ãƒâ€šÃ‚Â· fact-diff mainÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢head on
corpora (lost/gained with explanation)
ÃƒÂ°Ã…Â¸Ã‚Â¤Ã¢â‚¬â€œ Generated with [Claude Code](https://claude.com/claude-code)
```
