# F-010 — benchmark governance gate cannot fail: candidate handoff

Verification time: 2026-10-24 (local). Writer session worktree: `.claude/worktrees/brave-booth-4188af`
(branch `claude/brave-booth-4188af`, uncommitted). Evidence logs: `f010-evidence/` next to this note.

## Compact handoff

- TASK_ID: F-010 (P0/MEDIUM) — L05 benchmark audit gate passes checks that did no work
- BASELINE_SHA: af48a64b58046f61adf97531937f2fe60c3d7d93
- SCOPE: legacy-exodus-core benchmarks/audit.ts, cli.ts, types.ts, fixtures/; src/cli/commands/verify.ts,
  src/cli/presentation/verification.ts, src/cli/presentation/help.ts; two new test files. No CI/docs edits.
- CANDIDATE IDENTITY: `git diff | sha256sum` = 10ccd51e2bec28fded7ee2ab84f811f3f474310327eb64974c64a6163f7c40f7;
  untracked blobs in `f010-evidence/candidate-identity.txt`.
- VERDICT: CANDIDATE_READY for independent verification / red team. Delivery NOT_AUTHORIZED.

## Root cause

1. `benchmarks/audit.ts` counted checks 8/9/10 as passed unconditionally; check 6 passed on an empty population;
   checks 1 and 3 passed on zero inputs; checks 4/5 reported a missing `benchmarks/.cache/cookie-parser` as HIGH.
2. `benchmarks/cli.ts` exited non-zero only for `NO_GO` (a CRITICAL finding), so `PASS_WITH_CONDITIONS` 8/10 exited 0.
3. `src/cli/commands/verify.ts` hard-coded `"10/10 audit checks verified"` and looked only at the exit code.
CI never acquires the cache, so CI ran 8/10 with exit 0 (run 39399409238, conclusion success).

## Change

- Checked-in fixture `benchmarks/fixtures/governance-audit/` (4 files, ~40 lines JS) pinned by SHA-256 of
  LF-normalized content in `governance-audit.pin.json`; the fixture dir must contain exactly the pinned files.
  Runs execute in a temp copy (3 runs), so nothing writes into the source tree and no network is needed.
- Audit restructured into 8 isolated checks; any exception or missing/empty input → CRITICAL "could not run".
  Removed constant checks "Stale Artifact Isolation" and "Benchmark Overhead"; "Health Score Aggregator
  Invariants" is now real (5 synthetic cases through computeFileAccounting/verifyCompleteness/computeHealthScore).
  Accounting requires discovered == pinned file count on every run; determinism requires non-empty, identical
  artifact sets across 3 runs; sampling requires population > sample size, reproducibility and seed sensitivity
  (fixed sampler identities so it does not vary per engine commit).
- Report gains `checks[]` (id, name, passed, evidence). `isAuditPassing`: PASS verdict and every check passed.
- CLI: `audit [--root <dir>] [--json]`; exit 1 unless `isAuditPassing` (uses exitCode so piped JSON flushes).
- verify: runs `bun run benchmark audit --json`, zod-parses it, cross-checks counts against `checks[]`,
  reports the real `N/M`; unreadable or inconsistent output fails closed; findings shown as diagnostics.

## Contract evidence for "any failed check fails the gate"

.agents test-verification L05 "All governed checks pass"; contribution-guide.md:108 "returns ... (PASS)";
AGENT_OPERATING_MODEL.md:218 "Verdict: PASS with all benchmark audit checks satisfied"; testing-strategy.md:47.

## Gates (frozen candidate, Windows 11, Bun 1.4.2)

typecheck PASS; focused+subsystem 74/74; full `bun run test` 1626 pass / 1 skip (pre-existing win32 skipIf,
init.test.ts:79) / 0 fail; `bun run benchmark audit` PASS 8/8 exit 0; 3× `audit --json` identical digest
4e13025c… (auditedAt excluded); `bun run verify` 4/4 PASS incl. "8/8 audit checks verified"; `--help` exit 0;
`git diff --check` exit 0. Two earlier full runs failed with Out-of-memory/spawn errors under host memory
pressure (0.8 GB free; logs `*-oom.log`), classified ENVIRONMENT_FAILURE; the clean rerun passed on identical
non-test content (only a test-diagnostic message changed between them).

RED on af48a64 (pristine `git archive` export + new tests): 12/12 fail — verdict PASS_WITH_CONDITIONS not NO_GO;
audit throws ENOENT on a bare workspace; CLI exits 0 with checks unrunnable; CLI 8/10 exit 0; verify prints
`[PASS] … 10/10` for 8/8, 7/8, unreadable and inconsistent results. Fixture-dependent tests fail on missing fixture.

Mutation probes (sandbox copy): 8/9 killed (constant-pass sampling, exit-only-on-NO_GO, unrunnable=HIGH,
verify-by-exit-code, no count consistency, pin not enforced, zero src files, zero manifests). Survivor:
dropping the sampling seed-sensitivity condition (needs a broken sampler to observe; no seam added).

## Adjacent findings (not fixed)

- A1: `benchmarks/` is outside tsconfig `include`; harness.ts (21), runner.ts, sample.ts, scripts/report.ts and
  cli.ts carry latent strict-mode errors. Tests here call the audit in a child process to avoid pulling them in.
- A2: `benchmarks/cli.ts validate` compares CompletenessStatus to "COMPLETE" (never true) — badge always NEEDS_REVIEW.
- A3: `verifyDeterminism` ignores artifacts present only in later runs (audit now compares artifact sets itself).
- A4: `docs/adr/ADR-006-security-model.md:41` cites "Check 8 … zero symlink traversal regressions"; Check 8 never
  tested symlinks (it was a constant pass).

## Documentation impact: REQUIRED (not edited)

CONTRIBUTING.md:51; docs/development/contribution-guide.md:108; docs/development/cli/commands.md:154;
docs/development/local-development.md:77; docs/development/testing-strategy.md:28 (audit does not sweep
Tier 1/2/3); docs/adr/ADR-006-security-model.md:41; .github/pull_request_template.md:24; ROADMAP.md:44;
.agents/skills/legacyexodus-test-verification/SKILL.md:44 (governance route). CHANGELOG historical "10/10"
entries describe past releases; an Unreleased F-010 entry is the right vehicle.
