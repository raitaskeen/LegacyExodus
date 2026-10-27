# Fidelity helper analyzer-identity remediation — candidate handoff

Verification time: 2026-10-21 (local). Writer session: fervent-volhard-4763d4.

## Compact handoff

- TASK_ID: fidelity-helper stale-projection reuse (test-harness sibling of F-001)
- BASELINE_SHA: af48a64b58046f61adf97531937f2fe60c3d7d93 (local main == origin/main via ls-remote)
- BRANCH / WORKTREE: claude/fervent-volhard-4763d4 @ .claude/worktrees/fervent-volhard-4763d4 (uncommitted)
- SCOPE: legacy-exodus-core/tests/unit/governance/test-fidelity-helpers.ts and fidelity-freshness-lock.test.ts only
- FILES_CHANGED: the two files above (git diff sha256 e449c1eeb81a70210784c1ff9995e315eab1e651ccf01028d3eb07c4bd99c38b;
  blobs 94f7957917cc980e39d7b791f0d418e733bf486a test, 0e5c6e54e80c4cebe60ba825f7916144a89cc335 helper)
- VERDICT: CANDIDATE_READY for independent verification / red team. Delivery NOT_AUTHORIZED (no commit/push/PR).
- NEXT_AUTHORIZED_ROLE: independent red team, then human/Git governor.

## Root cause (two legs, same helper)

1. Currency check: `ensureDiscoveryProjections` reused `.discovery` when `manifest.engine.commitSha == git rev-parse HEAD`
   (or any non-empty SHA when Git is unavailable). HEAD does not change with uncommitted engine edits.
2. Regeneration was not a regeneration: the helper called `AnalyzeProject` without `refresh`, and on main the engine's own
   snapshot reuse (command-handler.ts:112, validator has no analyzer identity — F-001 / PR #198) accepts any internally
   consistent snapshot while the corpus workspace is unchanged. Probe: a re-hashed stale dependency survived a no-refresh
   run and was removed by `refresh: true`. Without fixing leg 2, a content fingerprint would have certified stale output.

## Change

- Reuse only when the helper itself recorded, in `.discovery/fidelity-helper.identity` (non-`*.json` so harness/profile
  artifact enumerators ignore it), `{ analyzerFingerprint, manifestSha256 }` matching the current analyzer fingerprint and
  the current manifest bytes. Git is no longer consulted.
- Fingerprint: sha256 over every file under `src/` (excluding `.discovery`, `.legacy-exodus`, `.git`, `node_modules`),
  package.json, bun.lock, tsconfig.json, Bun version. ~139 files, 32–55 ms.
- Default root fingerprint captured once per process at helper module load (after the static engine import; src has no
  dynamic imports), so a record describes the code that ran. `analyzerRoot` option = test seam, fingerprinted per call.
- Record removed before regeneration; regeneration uses `refresh: true`; record written only after `execute` resolves
  (engine throws on run/projection failure) and only when the fingerprint is readable (fail closed otherwise).

Measured alternative (always regenerate): fresh Express 17.9 s / Fastify 48.5 s vs reuse 2.4 s / 6.9 s; each repo is
requested by two test files, so ~130 s added per full run. Rejected.

## Tests (fidelity-freshness-lock.test.ts, helper block)

Contract change documented in a comment above the describe block.
- 1, 3: kept reuse expectation, fixture now a helper-generated projection with recorded identity (3 with Git mocked away).
- 2, 4, 5, 6: unchanged (no record -> regenerate; still true).
- 7: flipped (padded HEAD SHA without record -> regenerate); 8 new (HEAD SHA without record -> regenerate).
- 9 uncommitted src edit (with same-content reuse control), 10 package.json/bun.lock/tsconfig.json/added src file,
  11 control: `src/.discovery` output does not change identity, 12 rewritten-but-consistent projection regenerated without
  engine snapshot reuse, 13 unreadable analyzer root -> regenerate, no record.

RED on baseline af48a64 (helper unchanged): 7, 8, 9, 10, 12 fail at the intended post-change assertions; 1–6, 11 pass
(log: fidelity-helper-red-af48a64.log). Case 13 added later; RED re-proved with baseline helper + final tests in a scratch
git copy: 7, 8, 9, 10, 12, 13 fail; 1–6, 11 pass (log: fidelity-helper-red-baseline-with-case13.log).

E2E (scratch copy, not a git repo): express-fidelity unchanged src -> reused (4 s); one-line uncommitted edit to
src/semantic/call-graph-builder.ts -> regenerated (17 s, fingerprint 29328846… -> 2335f06d…); next run reused (1 s).

## Ten layers (final frozen candidate)

| Layer | Command | Result |
|---|---|---|
| L01 | bun test tests/unit/governance/fidelity-freshness-lock.test.ts | PASS 30/30 |
| L02 | bun test tests/unit/governance/ | PASS 81/81, 8 files |
| L03 | bun run test (coverage) | PASS 1620 pass, 1 skip (pre-existing init.test.ts:79 skipIf win32), 0 fail, 16919 expects, 145 files |
| L04 | bun run typecheck | PASS exit 0 |
| L05 | bun run benchmark audit | PASS 10/10 |
| L06 | 3x focused + express/fastify/closed-world | PASS 40/40 x3; identity records byte-identical before/after (no regeneration) |
| L07 | bun run verify | PASS typecheck/test/audit/diff hygiene |
| L08 | bun run src/cli/index.ts --help | PASS exit 0 |
| L09 | git diff --check; scoped diff | PASS; only the 2 allowlisted files; no untracked files |
| L10 | tree state | initial clean task tree at af48a64; candidate dirty only within allowlist; ignored local corpus copy + node_modules |

Environment: Windows 11, Bun 1.4.2, `bun install --frozen-lockfile --ignore-scripts`; corpus copied locally (no network)
from the main checkout's benchmarks/.cache excluding `.discovery`. Machine had ~13 other bun processes (timing variance).
An earlier `bun run verify` overlapped an in-progress edit and failed 1 test; superseded by the final run above.

## Known limitations

- Installed node_modules versions not fingerprinted (bun.lock is); symlinked files under src not fingerprinted.
- Identity record is unauthenticated (local test cache, honest-tooling threat model; production path uses F-001 HMAC).
- Edits landing between engine module evaluation and the load-time fingerprint read (ms window) could be recorded as
  the loaded identity; edits after capture only cause a regeneration next process. Load-time capture and Bun-version input untested.
- Helper does not verify artifact bytes beyond the manifest digest; runFidelityValidation enforces per-artifact SHA-256.

## Adjacent findings (not fixed)

- A1: benchmarks/fidelity/runner.ts (~lines 116–136) labels `freshnessStatus` FRESH/STALE by manifest SHA vs git HEAD —
  same HEAD-is-identity flaw at report-label level; uncommitted engine edits report FRESH. Cases K/L/R/S encode it.
- A2: engine snapshot reuse lacks analyzer identity on main (F-001, PR #198). Helper no longer depends on it.
- A3: test-fidelity-helpers.ts acquireRepository fallback ignores the `git checkout <revision>` exit code.

Documentation impact: NONE (no docs reference the helper). Memory status: not applicable.
