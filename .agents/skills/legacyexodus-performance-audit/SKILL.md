---
name: legacyexodus-performance-audit
description: Read-only baseline measurement, resource scaling and controlled candidate comparison for LegacyExodus; no speculative optimization or repairs.
---

# legacyexodus-performance-audit

## When to use

Investigate suspected slowness, retention, scaling or a candidate's performance
impact. Do not use for implementation or to certify correctness from timing.

## Context manifest

Mandatory: [kernel](../../core/KERNEL.md),
[lifecycle](../../protocols/LIFECYCLE.md),
[role matrix](../../protocols/ROLES.md), and the applicable
[report contract](../../templates/REPORTS.md).
Mandatory: [engine](../../context/ENGINE.md), benchmark scripts/config,
corpus identity and prepared measurement environment. Optional: retention tests,
heap profiles and relevant call paths. Irrelevant by default: unmeasured
optimization proposals, unrelated corpora and all other skills.

## Inputs and authority

A baseline workspace is sufficient for a suspicion investigation. Comparison
requires both unchanged baseline and exact candidate workspaces prepared by the
invoking workflow/Git governor. Auditor does not create/switch/reset them or edit
source/tests/corpora. Measurements that emit caches/artifacts run in prepared
isolated execution copies; inspection workspaces remain read-only.

## Procedure

1. Record revisions/content, corpus, hardware/OS, runtime version and environment.
   Note interference; do not terminate unrelated user processes.
2. Review commands and run baseline first. Use equal conditions, separate
   discarded warm-up and at least three measured runs on each compared side.
3. Report raw samples, median wall/CPU time, peak RSS, throughput and variance;
   unavailable metrics remain unavailable. Compare output digests and semantics.
4. Delta = (candidate - baseline) / baseline * 100; zero baseline means delta
   undefined. Resource delta >3% is REGRESSION, <-3% IMPROVEMENT, inclusive
   [-3%,3%] NO_MATERIAL_CHANGE; reverse improvement/regression for throughput.
   These thresholds do not overcome noise: variance >3% or environmental
   interference yields INCONCLUSIVE, not a forced performance conclusion.
5. Distinguish MEASURED, PROVEN_COMPLEXITY, LIKELY_COMPLEXITY and SPECULATIVE_RISK.
   Assess bounded AST working-set scaling separately from whole-repository memory.
   Inspect retention tests, multiple corpus sizes, heap/GC evidence and long-lived
   containers. A small RSS sample or >10-file smoke run does not prove OOM safety.
6. If scaling is unestablished, state: Memory/OOM neutrality was not established
   by this benchmark. Report memory status VERIFIED, INCONCLUSIVE, REGRESSION,
   IMPROVEMENT or NO_MATERIAL_CHANGE with the exact bounded claim.

## Stop conditions

Kernel stops; incomparable conditions; nondeterminism; missing baseline; required
unsafe mutation. No performance fix claim without measurable baseline evidence;
never sacrifice semantic correctness to improve metrics.

## Output and next handoff

Audit report with samples, baseline/candidate/delta/classification table,
determinism, scaling limitations, and PASS/REGRESSION_DETECTED/INCONCLUSIVE.
Measured defect -> design or implementation; suspicion without proof -> bounded
measurement follow-up. No closure authority.
