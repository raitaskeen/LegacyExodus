---
name: legacyexodus-test-verification
description: Independently verify a frozen LegacyExodus candidate using discovered commands and ten explicit evidence layers; never repair it while verifying.
---

# legacyexodus-test-verification

## When to use

Verify code/tests/toolchain changes, or investigate reproducibility and flakiness.
Do not use to repair failures or to impose engine gates on documentation-only work.

## Context manifest

Mandatory: [kernel](../../core/KERNEL.md),
[lifecycle](../../protocols/LIFECYCLE.md),
[role matrix](../../protocols/ROLES.md), and the applicable
[report contract](../../templates/REPORTS.md).
Mandatory: frozen diff, relevant tests/contracts, package scripts and CI.
Optional: [engine](../../context/ENGINE.md) for semantic claims, performance
procedure for measurements. Irrelevant by default: unrelated source and roadmaps.

## Inputs and authority

Exact baseline/candidate identities, environment, gate plan and prepared isolated
verification workspace. Candidate is read-only; artifact-emitting commands execute
only in the prepared verification workspace, never in the inspection checkout.
Review scripts before execution; supplied logs must identify identical content.

## Procedure

Discover actual commands from package scripts, CI and then project docs.
Reconcile any mismatch; examples below must be revalidated rather than copied
as timeless commands. Execute from legacy-exodus-core unless the command requires
repository root. After baseline RED, candidate order starts with static typecheck,
then focused/subsystem/full tests and remaining gates.

| Layer | Evidence |
|---|---|
| L01 Focused | Exact regression, negative controls and RED/GREEN reason |
| L02 Subsystem | Affected callers and siblings |
| L03 Full | Live files/pass/fail/skip/assertion totals; zero unexpected failures |
| L04 Static | Compiler exit 0, zero errors |
| L05 Benchmark governance | All governed checks pass (current contract: 10/10) |
| L06 Determinism | At least three identical-input runs, output digests and scope |
| L07 Composite | Actual verify command and constituent outcomes |
| L08 CLI smoke | Exit 0 and expected help behavior |
| L09 Diff hygiene | Full scoped diff, untracked content, git diff --check |
| L10 Tree state | Initial clean task tree; candidate allowlist; post-delivery clean when authorized |

Current command discovery anchors: package.json scripts typecheck, test,
benchmark, verify; CI also invokes CLI --help and focused Windows tests.
bun test and bun run test differ (coverage artifacts); record the actual command.
Benchmark commands may write/delete caches. Composite verify is not proof of
remote CI or whole-tree cleanliness; inspect its implementation.
Do not rerun unchanged constituents unnecessarily if exact evidence can be reused;
do not claim the composite command ran merely because constituents passed.

For every layer report COMMAND, RESULT, SCOPE, ENVIRONMENT, LIMITATION. Core
remediation requires all applicable code gates; list all ten even if genuinely
not applicable. Remote CI/cross-platform results must be distinguished from local
results. NOT_RUN is a gap, not PASS. Do not install dependencies or fetch corpora
without checking execution effects and task/network authority.

## Stop conditions

Kernel stops, command/environment uncertainty, test/contract contradiction, or
unexpected failure. Classify the failure under the lifecycle; never repair it
inside verification or weaken its expected result.

## Output and next handoff

Ten-layer table, aggregate live totals, skips, exact candidate identity, limitations
and PASS/FAIL/INCONCLUSIVE -> writer for failures, independent red team for
verified candidates. Candidate tree can legitimately contain only reviewed edits;
this is not a reason to commit without authorization.
