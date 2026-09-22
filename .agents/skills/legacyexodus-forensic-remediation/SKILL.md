---
name: legacyexodus-forensic-remediation
description: Implement one confirmed LegacyExodus defect with failure-first evidence in an isolated feature worktree; stop at independent review and authorization gates.
---

# legacyexodus-forensic-remediation

## When to use

A confirmed bounded bug, semantic defect, security issue or measured performance
defect has an explicit contract. Do not use for unconfirmed anomalies, broad
redesign, docs-only work, or unresolved semantic choices.

## Context manifest

Mandatory: [kernel](../../core/KERNEL.md),
[lifecycle](../../protocols/LIFECYCLE.md),
[role matrix](../../protocols/ROLES.md), and the applicable
[report contract](../../templates/REPORTS.md).
Mandatory: [engine](../../context/ENGINE.md), canonical finding, relevant
contracts/source/tests, and Git preparation plus verification procedures selected
by the router. Optional: performance measurement for resource claims, applicable
docs evidence for impact assessment. Irrelevant by default: unrelated skills,
unrelated findings and roadmap implementations.

## Inputs and authority

One confirmed root cause, baseline, scope allowlist, invariant and success criteria.
Only the writer edits scoped source/tests in its isolated feature worktree.
Documentation impact is reported as REQUIRED or NONE; core remediation does not
edit README, CHANGELOG or docs. Required docs work is a separate authorized task.

## Procedure

Execute the lifecycle's remediation sequence without defining a competing order.
The forensic contract must explain evaluation order, identity, provenance and
uncertainty relevant to the defect, not just the expected test count.
Use strict observable assertions, positive/negative cases, unchanged-valid-behavior
controls and preserved baseline RED proof. An isolated green example is insufficient.
Classify adjacent findings before implementing; do not absorb them.
Run the ten-layer verification contract, then adversarial self-review and
independent red-team. Preserve valid tests and counterexamples on both loopbacks.
Complete the reviewed candidate before requesting any missing delivery permission.

## Stop conditions

Kernel stops; no valid RED evidence; contract or root-cause boundary fails;
another finding is necessary (SCOPE_EXPANSION_REQUIRED). A failed candidate
returns to design if a local correction cannot preserve valid prior behavior.
Do not rationalize regression as conservative behavior without contract evidence.

## Output and next handoff

Remediation report, ten-layer evidence, memory limitation, documentation impact,
frozen diff and handoff -> independent verification/red-team.
After acceptance -> human/Git governor only for explicitly authorized operations.
No self-certification, automatic commit, or finding closure.
