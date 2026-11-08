---
name: legacyexodus-red-team-review
description: Independent read-only adversarial challenge of an exact candidate, test semantics and changed behavior; returns pass, fail or inconclusive.
---

# legacyexodus-red-team-review

## When to use

Challenge a candidate before acceptance or assess external review evidence.
Do not use to implement, repair tests, or certify a candidate you authored.

## Context manifest

Mandatory: [kernel](../../core/KERNEL.md),
[lifecycle](../../protocols/LIFECYCLE.md),
[role matrix](../../protocols/ROLES.md), and the applicable
[report contract](../../templates/REPORTS.md).
Mandatory: exact base and complete candidate diff, untracked file contents,
contract, RED proof and verification logs. Optional: [engine](../../context/ENGINE.md),
relevant callers, comparative measurements. Irrelevant by default: unrelated
history and all other skills. Author conclusions are claims, not ground truth.

## Inputs and authority

Frozen baseline, candidate identity and scope. Inspect all changes since the
resolved base/merge-base, not just HEAD~1. Candidate is strictly read-only.
Safe probes may be constructed only in prepared authorized external scratch or
verification copies; never add RED tests to the candidate. Artifact-emitting
verification must use those copies or trustworthy exact-candidate logs.

## Procedure

Supply evidence or an explicit evidence gap for each question:
1. Which assumption could be wrong?
2. Which boundary/input case is missing?
3. Can a test pass for the wrong reason?
4. Was the structural root cause corrected?
5. Did previously valid behavior change elsewhere?
6. Did determinism change?
7. Did memory/resource behavior change?
8. Did error handling, uncertainty or failure visibility change?
9. Is the diff larger than the authorized cause requires?
10. Are documented claims now inaccurate?
11. Is there a toolchain/dependency or execution-environment problem?

Construct changed-result differential probes against unchanged baseline and
candidate, negative controls, and relevant nested/ordered/aliasing cases.
Check expected behavior independently from the new test. Separate adjacent
findings from defects invalidating this candidate. Review full gate evidence;
normal suite green does not dismiss a valid counterexample.

## Stop conditions

Kernel stops; candidate changed during review; insufficient safe verification;
author-only evidence cannot establish the disputed claim. Do not silently fix.
Missing required evidence yields RED_TEAM_INCONCLUSIVE.

## Output and next handoff

RED_TEAM_PASS, RED_TEAM_FAIL, or RED_TEAM_INCONCLUSIVE using the report contract.
FAIL specifies counterexample, expected/actual, invalidation reason, and Path A
implementation or Path B test quality. Follow lifecycle loopbacks; false scope
boundary -> design. PASS permits candidate review progression, not Git delivery,
merge, or issue closure.
