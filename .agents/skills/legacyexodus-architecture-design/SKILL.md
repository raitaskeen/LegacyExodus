---
name: legacyexodus-architecture-design
description: Design-only analysis of disputed LegacyExodus semantics, invariants and bounded implementation feasibility; no production or test edits.
---

# legacyexodus-architecture-design

## When to use

A contract is unclear, a candidate's scope boundary failed, or competing designs
need a bounded decision before implementation. This closes the gap between
read-only defect discovery and an authorized patch. Do not use to implement
an architecture, prototype production code, or restate settled invariants.

## Context manifest

Mandatory: [kernel](../../core/KERNEL.md),
[lifecycle](../../protocols/LIFECYCLE.md),
[role matrix](../../protocols/ROLES.md), and the applicable
[report contract](../../templates/REPORTS.md).
Mandatory: [engine](../../context/ENGINE.md), observed counterexamples,
current contracts, source and tests. Optional: relevant accepted ADRs and language
specification evidence. Irrelevant by default: unrelated roadmaps, vendor/model
preferences and implementation skills before readiness.

## Inputs and authority

Frozen baseline, design question, allowed artifact location and non-goals.
Read-only production/tests. May write only an explicitly authorized design
artifact in an isolated feature worktree; otherwise report in conversation.
No executable prototype or test creation without a new explicit task scope.

## Procedure

1. Follow lifecycle intake; separate actual behavior from required semantics.
2. Explain disputed invariants and provenance, ordering, aliasing, uncertainty,
   failure and resource obligations relevant to the question.
3. Compare minimal viable options with counterexamples, dependencies, tradeoffs,
   compatibility and non-goals. Do not equate a plausible algorithm with proof.
4. Define a bounded contract and a test model including positive/negative cases,
   unchanged behavior and differential observations.
5. State READY_FOR_SCOPED_IMPLEMENTATION, DESIGN_INCONCLUSIVE or
   SCOPE_EXPANSION_REQUIRED. Readiness is not implementation authorization.

## Stop conditions

Kernel stops; invariant cannot be established; another finding/architecture is
required; design would alter requirements without human decision.

## Output and next handoff

Design report and compact handoff -> human for contract/scope decisions, then
separately authorized implementation. No delivery or finding closure.
