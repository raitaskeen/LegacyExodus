---
name: legacyexodus-docs-audit
description: Read-only comparison of documentation claims with frozen implementation evidence, including stale review-base reconciliation.
---

# legacyexodus-docs-audit

## When to use

Audit claims, examples, diagrams, links or external docs review comments.
Do not use as writing authority or to change engine behavior. An explicitly
requested docs correction transitions to the separate docs-writer role.

## Context manifest

Mandatory: [kernel](../../core/KERNEL.md),
[lifecycle](../../protocols/LIFECYCLE.md),
[role matrix](../../protocols/ROLES.md), and the applicable
[report contract](../../templates/REPORTS.md).
Mandatory: [engine and documentation truth](../../context/ENGINE.md),
selected docs and branch-qualified source/test evidence. Optional: existing
documentation map, CLI help, schemas and relevant ADRs. Irrelevant by default:
unrelated docs, all skills, historical core snapshots. Never use docs-foundation's
core snapshot as current source/test/benchmark authority.

## Inputs and authority

Document scope and frozen implementation revision, distinct from docs revision.
Audit is read-only. Docs writer needs an explicit allowlist and isolated feature
worktree prepared through Git governance; it cannot edit production or tests.

## Procedure

1. Follow lifecycle intake. Verify implementation claims with frozen source,
   tests, CLI declarations/help and contracts.
2. Classify each claim TRUE_CURRENT, PARTIAL, TARGET, DEFERRED, EXPERIMENTAL,
   STALE or CONTRADICTED; attach evidence. DEFERRED needs a dated decision.
   Retain architecture-state labels for feature claims.
3. Identify STALE_CLAIM, ARCH_INFLATION, BROKEN_REFERENCE, INCORRECT_EXAMPLE,
   OMISSION, DUPLICATION, FLUFF/VAGUE, or NAVIGATION_GAP where material.
4. Reconcile review comments against actual implementation: CONFIRMED,
   STALE_REVIEW_CONTEXT, PARTIAL, or CORE_DOCS_MISMATCH. Check ancestry and
   content when squash history differs. Review comments are hypotheses.
5. Hand an evidenced minimal correction to an authorized docs writer. That
   role verifies changed claims, examples, links/anchors, diagrams and scope,
   then hands off to independent docs verification. It does not redefine
   contracts or rearrange the documentation tree without authorization.

## Stop conditions

Kernel stops; production correction needed; contradictory intended contract;
missing source truth. PR metadata requests do not authorize repository edits.

## Output and next handoff

Audit report plus document/line/category/claim/reality/recommendation table.
Docs writer -> independent docs verifier -> human/Git governor.
Core mismatch -> design or code audit, never a silent engine fix.
