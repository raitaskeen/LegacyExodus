# PR #202 (F-010) — independent red-team review

Reviewed 2026-10-28 (Windows 11, Bun 1.4.4, Git 2.56). Reviewer did not author the candidate.
Candidate read-only; execution in detached worktrees and a throwaway copy under `C:\Projects\.f010-review`.

## CANDIDATE

- Base `af48a64`; candidate `12a2d1307cb83ee7591db008a33a09d4d2e2584e` (one commit), still draft, not updated onto main.
- Complete diff: 13 files, +1003/−225 — `benchmarks/audit.ts`, `cli.ts`, `types.ts`, pinned fixture (4 files + pin),
  `src/cli/commands/verify.ts`, `presentation/help.ts`, `presentation/verification.ts`, 2 new test files.
- Merges cleanly onto main `7b6f1b3` (merge tree `f34d10a`); `git diff --check` clean.

## Evidence

| Check | Revision | Result |
|---|---|---|
| RED: new tests on base source | af48a64 + 2 test files | 12 / 12 fail |
| GREEN: new tests | 12a2d13; main+PR | 12 / 12 pass on both |
| Live bug on main (fresh worktree, no corpus cache) | 7b6f1b3 | `audit`: PASS_WITH_CONDITIONS 8/10, two HIGH findings, **exit 0** |
| Same on main+PR | local merge a503e8f | `audit`: PASS 8/8, exit 0, checked-in inputs only |
| `bun run verify` main+PR | a503e8f | typecheck 0; **1812 pass / 0 fail, 152 files**; audit **8/8** (real count); hygiene clean |
| `bun run verify` control | 7b6f1b3 | typecheck 0; 1 test failed in a 511 s run; audit "10/10" (hard-coded label) |
| Control suite re-run | 7b6f1b3 | 1800 pass / 1 skip / 0 fail, 151 s — earlier failure transient (load), unrelated to PR |
| Delta | — | 1812 − 1800 = 12 = exactly the PR's new tests |

## Mutation probes (throwaway copy of main+PR, `audit --json`)

| Probe | Result |
|---|---|
| M0 control | PASS 8/8, exit 0 |
| M3 `src/zz.ts` imports `"../benchmarks/types"` | NO_GO 7/8, `core-isolation` failed, exit 1 — killed |
| M4 one comment line appended to a fixture file | NO_GO 5/8, fixture-accounting / determinism / sampling failed, exit 1 — killed |
| M1 `src/cli/commands/zz.ts` imports `"../../../benchmarks/types"` | PASS 8/8 — **survives** |
| M2 single-quoted `'../../benchmarks/types'` | PASS 8/8 — **survives** |

M1/M2: check 1's string match (`from "../benchmarks`, `from "../../benchmarks`, `from "@benchmarks`) is unchanged
from base. No real violation exists in `src` today (independent regex search: none). Pre-existing limitation → adjacent.

## COUNTEREXAMPLES

None against the authorised cause (gate passing checks that did no work / exiting 0 on failed checks / verify
hard-coding 10/10). Every input-dependent check now throws → CRITICAL on missing/empty input; CLI exits 1 unless
`isAuditPassing`; verify zod-parses `--json`, cross-checks counts, and fails closed.

## UNCHANGED_BEHAVIOR

Full suite delta is only the new tests. Audit no longer needs network or `benchmarks/.cache`.

## DETERMINISM

Fixture runs are genuinely independent: snapshots live in the project's `.discovery`, which the audit deletes before
each of the 3 runs, so #198's snapshot reuse cannot make runs 2/3 copies of run 1 (key lives in LEGACY_EXODUS_HOME,
data in `.discovery`). Writer's evidence: 3× `audit --json` identical digest.

## RESOURCE_EFFECT

Audit 0.5 s → 1.6 s inside verify (3 small fixture analyses in a temp dir, removed in `finally`).
Note: run outside the test preload, the audit's engine runs create the snapshot HMAC key in `~/.legacy-exodus` — the
same as any `analyze` run and as main's old corpus-based audit; not a regression.

## Test quality

Verify tests run the real `verify` against stubbed scripts, with a passing control and fail-closed cases (exit 0 with
failed check, unreadable output, inflated counts). Gap: no test for JSON reporting PASS 8/8 while the audit exits
non-zero (code requires `audit.code === 0`; untested branch, not a defect). Writer's mutation survivor (sampling seed
sensitivity) acknowledged.

## Eleven probes (summary)

1 assumptions hold; 2 boundary gaps only in pre-existing check 1/2/3 heuristics; 3 RED reproduced, controls present;
4 root cause fixed at audit, CLI and verify; 5 no other behaviour change; 6 determinism isolated per run; 7 small cost;
8 failures now visible and fail closed; 9 diff proportionate; **10 documented claims are now inaccurate (below)**;
11 Bun 1.4.4 vs pinned 1.4.2 — no effect seen.

## Documentation impact: REQUIRED, not done in this candidate

Still claim 10 checks / "10-point": `CONTRIBUTING.md:51`, `docs/development/cli/commands.md:154`,
`docs/development/local-development.md:77`, `.github/pull_request_template.md:24`, `ROADMAP.md:44`,
`.agents/skills/legacyexodus-test-verification/SKILL.md:44`, `docs/adr/ADR-006-security-model.md:41` (Check 8 symlinks —
never tested), plus per handoff `docs/development/contribution-guide.md:108`, `docs/development/testing-strategy.md:28`;
add an Unreleased CHANGELOG entry. Historical CHANGELOG entries describe past releases and stay.

## Adjacent findings (not defects of this candidate)

- A1–A4 from the handoff (benchmarks outside tsconfig; `validate` badge; `verifyDeterminism` later-only artifacts; ADR-006).
- **A5 (new):** check 1 misses imports deeper than `../../` and single-quoted / `require` / dynamic imports (M1, M2).
- **A6 (new):** check 2 passes on any `.cache` substring; check 3 accepts any non-empty `revision` (tags are mutable).
- Main control had one transient suite failure under load (511 s run); not reproduced (151 s re-run).

## VERDICT

**RED_TEAM_PASS for the code change.** Delivery blocked on the REQUIRED documentation update (writer task on the PR
branch, then a quick docs verification), then update onto main and merge by the human / Git governor.
