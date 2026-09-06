---
name: legacyexodus-forensic-remediation
description: Canonical forensic remediation workflow for LegacyExodus core engineering defects, audit findings, and vulnerabilities.
---

# Skill: LegacyExodus Forensic Remediation

## 1. Purpose
This skill defines the canonical, step-by-step forensic engineering procedure for resolving confirmed defects, audit findings, and security vulnerabilities within the `legacy-exodus-core` codebase. It guarantees that every code change is minimal, evidence-backed, rooted in true causes, and protected by permanent regression tests.

## 2. Scope
Applies to all bug fixes, security patches, CodeRabbit/linter remediations, semantic engine adjustments, and correctness hardening across all subsystems in `legacy-exodus-core/`.

## 3. When to Use
* Resolving a confirmed bug or CodeRabbit finding.
* Fixing a static analysis, parser, scoping, or graph construction defect.
* Patching a security vulnerability (e.g., path traversal, subprocess isolation).
* Remediating a memory leak or lifecycle race condition.

## 4. When NOT to Use
* Broad architectural redesigns or target language rewrites (use Architecture Proposal workflow).
* Documentation-only updates or website edits (use `legacyexodus-docs-audit`).
* Performance benchmarking without an identified defect (use `legacyexodus-performance-audit`).
* Investigating an unconfirmed anomaly (use `legacyexodus-code-audit`).

## 5. Prerequisites
* Pre-task working tree check: `git status` MUST report a completely clean working tree (`nothing to commit, working tree clean`). Unexpected staged, unstaged, or untracked files must halt execution immediately.
* Active temporary task branch created from authoritative `core-foundation` (e.g., `fix/<finding-id>`).
* Bun runtime $\ge 1.3.0$ installed locally.
* Full alignment with the rules in [Permanent Charter](../../../docs/governance/PERMANENT_CHARTER.md).

## 6. Canonical Operating Procedure & Phase Requirements

> **CANONICAL SEQUENCE NOTICE:**
> For the mandatory remediation order, all agents MUST follow the **Canonical Forensic Remediation Sequence** (Steps 1 through 17) defined in [`docs/governance/AGENT_OPERATING_MODEL.md`](../../../docs/governance/AGENT_OPERATING_MODEL.md#41-canonical-forensic-remediation-sequence). This skill provides phase-specific technical requirements and execution constraints, and does NOT define an independent or competing sequence.

The canonical 17-step remediation pipeline is structured into six functional phases:

```text
Phase 1: Pre-Flight & Evidence Gathering (Steps 1–3)
   │
Phase 2: Defect Isolation & RED Test Creation (Steps 4–6)
   │
Phase 3: Surgical Remediation & Focused Verification (Steps 7–8)
   │
Phase 4: Full Pipeline Verification Gates (Steps 9–12)
   │
Phase 5: Diff Hygiene & Verification Report (Steps 13–14)
   │
Phase 6: Commit, Push & Hard Stop (Steps 15–17)
```

### Phase 1: Pre-Flight & Evidence Gathering (Steps 1–3)
* **Pre-Flight Validation (Step 1):** Verify that the working tree is pristine (`git status` reports `nothing to commit, working tree clean`) and that you are on a dedicated task branch created from `origin/<base-branch>`.
* **Evidence Gathering (Step 2):** Inspect current source code, AST node mappers, flow analyzers, and live execution logs. Never assume external report text is accurate; verify the issue directly against live code.
* **Finding Confirmation (Step 3):** Confirm the defect against current implementation code on `core-foundation:legacy-exodus-core/src/`. Formulate a minimal code reproduction or CLI command.

### Phase 2: Defect Isolation & RED Test Creation (Steps 4–6)
* **Smallest Safe Change Definition (Step 4):** Pinpoint the structural/semantic root cause and define the minimal architectural fix that resolves it.
* **Author RED Regression Test (Step 5):** Create a dedicated regression test file in `legacy-exodus-core/tests/` isolating the failure. Loose assertions (`toBeTruthy()`, `toBeDefined()`) are strictly forbidden where exact values or AST contracts can be asserted.
* **RED Test Failure Verification (Step 6):** Execute `bun test <path-to-test>`. The test **MUST demonstrably FAIL** before any source code is changed. Record the failure output and assertion details.

### Phase 3: Surgical Remediation & Focused Verification (Steps 7–8)
* **Apply Smallest Safe Remediation (Step 7):** Modify exclusively the source files in `legacy-exodus-core/src/` needed to correct the root cause. Do NOT refactor adjacent methods, reformat untouched code, or modify unrelated contracts.
  * *Red-Team Loopback:* If a Red-Team review emits `RED-TEAM FAIL`, the workflow returns directly to Step 7. The minimal reproduction is preserved, the fix is adjusted, and the workflow re-enters Step 8.
* **Focused Test Verification (Step 8):** Re-run the regression test (`bun test <path-to-test>`). Confirm that it now **PASSES** cleanly.

### Phase 4: Full Pipeline Verification Gates (Steps 9–12)
* **Static Typecheck (Step 9):** Run `bun run typecheck` in `legacy-exodus-core/`. Must exit with code 0 and zero compiler errors.
* **Full Test Suite Verification (Step 10):** Run `bun test` in `legacy-exodus-core/` across all 113+ test files. Must achieve 100% pass rate with zero failures.
* **Benchmark Governance Audit (Step 11):** Run `bun run benchmark audit` in `legacy-exodus-core/`. All 10/10 audit checks must pass.
* **CLI Smoke Verification (Step 12):** Run `bun run src/cli/index.ts --help` in `legacy-exodus-core/`. Must exit with code 0 and valid help output.

### Phase 5: Diff Hygiene & Verification Report (Steps 13–14)
* **Git Diff & Hygiene Review (Step 13):** Run `git diff --stat` and `git diff --check`. Verify zero trailing whitespace, zero extraneous files, and strictly scoped changes.
* **Mandatory Verification Report (Step 14):** Generate the complete remediation report incorporating the 10-layer `verification_report` schema from [`legacyexodus-test-verification`](../legacyexodus-test-verification/SKILL.md).

### Phase 6: Commit, Push & Hard Stop (Steps 15–17)
* **Atomic Conventional Commit (Step 15):** Stage only remediated files and test files. Commit with Conventional Commit message and co-authorship.
* **Remote Push & Postcondition (Step 16):** Push to `origin <task-branch>`. Confirm `git status` reports `nothing to commit, working tree clean`.
* **Mandatory Hard Stop (Step 17):** Halt execution immediately. Await human maintainer review.

---

## 7. Evidence Requirements
* **Failure-First Evidence:** Recorded failure log showing the regression test failing before the fix.
* **Resolution Evidence:** Recorded passing log of the regression test after the fix.
* **Non-Regression Evidence:** Full test suite execution log (`bun test`) showing 100% passing tests.

## 8. Mandatory Verification Report & Downstream Evidence Contract
Every completed forensic remediation MUST explicitly invoke and incorporate the standard `verification_report` contract defined in [`legacyexodus-test-verification`](../legacyexodus-test-verification/SKILL.md).

Merely stating "tests passed" is strictly forbidden and constitutes false closure. The completion report MUST document:
1. **Test Metrics:** Total test files, total tests passed, total tests failed (must be 0), and total `expect()` assertion calls across the full test suite.
2. **Ten Verification Layers:** Complete structured results (`PASS | FAIL | SKIPPED`) and recorded evidence for all ten verification layers (L01 through L10) as defined in `.agents/skills/legacyexodus-test-verification/SKILL.md`.
3. **Static Typecheck:** Exit code (0) and 0 compiler errors from `bun run typecheck`.
4. **Benchmark Governance Audit:** Explicit pass verdict and confirmation of 10/10 checks passed from `bun run benchmark audit`.
5. **CLI Smoke Verification:** Exit code (0) and confirmation of clean help output from `bun run src/cli/index.ts --help`.
6. **Diff & Scope Hygiene:** Output of `git diff --check` and `git diff --stat`.
7. **Memory Scalability Status:** Exactly one of the 5 allowed statuses (`VERIFIED`, `INCONCLUSIVE`, `REGRESSION`, `IMPROVEMENT`, `NO MATERIAL CHANGE`) per `.agents/skills/legacyexodus-performance-audit/SKILL.md`.
8. **Worktree Status:** Precondition clean check and postcondition clean check (`nothing to commit, working tree clean`).

The downstream verification report is mandatory evidence required to certify finding completion.

## 9. Failure Handling
* If the red test does not fail before the fix: The test does not properly isolate the defect. Refine the test before touching source code.
* If full test suite fails after the fix: The change introduced a side-effect. Revert the fix and re-evaluate root cause.
* If benchmark audit fails: The change regressed determinism, accounting, or performance. Revert and investigate.

## 10. Closure Criteria
A finding is classified as `FULLY REMEDIATED` if and only if:
1. Root cause is proven and corrected.
2. Permanent automated regression test is committed.
3. Full verification suite passes with zero errors.
4. Git working tree is clean and branch is pushed to origin.

## 11. Prohibited Behavior
* Never commit a fix without a failure-first test where applicable.
* Never weaken assertions or delete tests to achieve a pass.
* Never fix multiple unrelated findings in one commit or PR.
* Never modify documentation or README in a core remediation commit.
* Never continue to another task without stopping.

## 12. Expected Output Format
Terminates with the standard verification and remediation completion report specified in [Agent Operating Model §5.2](../../../docs/governance/AGENT_OPERATING_MODEL.md#52-remediation-completion-report-builder--red-team--human), incorporating the complete 10-layer `verification_report` artifact.
