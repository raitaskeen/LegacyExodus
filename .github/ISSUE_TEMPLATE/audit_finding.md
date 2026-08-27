---
name: Audit Finding
about: Track and investigate a discrete whole-repository audit finding (F-001 ... F-015)
title: "[Audit] F-XXX: <Finding Title>"
labels: ["audit", "type:bug"]
assignees: []
---

## Finding ID
<!-- e.g. F-008 -->

## Severity
<!-- Critical | High | Medium | Low -->

## Subsystem
<!-- e.g. Storage / SQLite, Discovery, Runtime, Semantic Analysis -->

## Problem Description
<!-- Concrete statement of the defect or integrity gap. -->

## Observed Evidence / Reproduction
<!-- Reproduction steps, test results, or codebase citations. -->

## Expected Invariant
<!-- How the system should deterministically behave. -->

## Scope Boundary
- **In Scope:** <!-- Strictly isolated to closing this exact finding -->
- **Out of Scope:** <!-- Adjacent refactors, other findings -->

## Acceptance Criteria
- [ ] Problem reproduced or disproven
- [ ] Root cause identified
- [ ] Minimal production fix implemented
- [ ] One focused regression test added
- [ ] Typecheck, full tests, and benchmark audit pass cleanly
- [ ] Documentation updated if contracts changed
