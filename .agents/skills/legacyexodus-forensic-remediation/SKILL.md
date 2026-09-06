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

## 6. Canonical Operating Procedure
Agents MUST execute the following 13-step sequence in strict order without omitting or reordering steps:

```text
EVIDENCE ──► REPRODUCTION ──► ROOT CAUSE ──► RED TEST ──► SMALLEST FIX
   │
   ▼
FOCUSED TEST ──► FULL TEST ──► TYPECHECK ──► BENCHMARK ──► DIFF REVIEW ──► COMMIT ──► PUSH ──► STOP
```

### Step 1: Evidence Gathering
* Inspect current source code, contracts, and relevant test files.
* Do NOT assume external finding text is accurate; verify the issue against live code.
* Identify the exact file, symbol, and line numbers involved.

### Step 2: Reproduction
* Reproduce the failure via a minimal script or focused CLI command.
* If the defect cannot be reproduced, halt and mark the finding `NOT_REPRODUCED`.

### Step 3: Root Cause Analysis
* Distinguish symptoms from root causes.
* Trace the flaw to the fundamental AST node handling, lexical scope resolution, or state machine transition.

### Step 4: Author Red (Failure-First) Regression Test
* Author a dedicated, automated regression test in the relevant test directory (`tests/unit/...` or `tests/integration/...`).
* Execute the test:
  ```bash
  bun test tests/path/to/regression.test.ts
  ```
* **Verify that the test demonstrably FAILS against the current code.**
* Record the exact failure message and assertion error.

### Step 5: Smallest Safe Remediation
* Apply the minimal necessary code change to `legacy-exodus-core/src/` to resolve the root cause.
* Prohibit refactoring adjacent methods, renaming unrelated variables, or modifying untouched contracts.

### Step 6: Focused Test Verification
* Re-run the red regression test:
  ```bash
  bun test tests/path/to/regression.test.ts
  ```
* Confirm that the test now PASSES cleanly.

### Step 7: Full Test Suite Verification
* Run the complete test suite across all 113+ test files:
  ```bash
  bun test
  ```
* Confirm 100% test pass rate with zero failures across all test files.

### Step 8: Static Typecheck Verification
* Execute TypeScript compiler verification in canonical package root `legacy-exodus-core/`:
  ```bash
  bun run typecheck
  ```
* Confirm that compilation exits with code 0 and zero compiler errors. Recorded evidence of typecheck completion is mandatory.

### Step 9: Benchmark & Determinism Verification
* Execute the benchmark governance audit:
  ```bash
  bun run benchmark audit
  ```
* Confirm `Verdict: PASS` across all 10/10 checks.

### Step 10: Git Diff & Hygiene Review
* Before staging, verify diff hygiene and changed file scope:
  ```bash
  git diff --stat
  git diff --check
  ```
* Ensure no trailing whitespace, debug statements, or temporary files remain.

### Step 11: Atomic Conventional Commit
* Stage strictly the remediated file(s) and regression test(s):
  ```bash
  git commit -m "fix(<subsystem>): <concise summary>" \
             -m "- Address root cause: <explanation>" \
             -m "- Add regression coverage in <test-path>" \
             -m "- Remediate finding <finding-id>"
  ```

### Step 12: Remote Push
* Push the atomic commit to the remote task branch:
  ```bash
  git push origin <task-branch>
  ```
* Post-push working tree verification: Confirm that `git status` reports `nothing to commit, working tree clean`.

### Step 13: Mandatory Stop
* **HARD STOP.** Do NOT proceed to the next finding.
* Output the standard remediation completion report.

---

## 7. Evidence Requirements
* **Failure-First Evidence:** Recorded failure log showing the regression test failing before the fix.
* **Resolution Evidence:** Recorded passing log of the regression test after the fix.
* **Non-Regression Evidence:** Full test suite execution log (`bun test`) showing 100% passing tests.

## 8. Verification Requirements
* `bun run typecheck`: 0 errors.
* `bun test`: 100% passed (0 failed).
* `bun run benchmark audit`: 10/10 checks passed.
* `git diff --check`: 0 whitespace/diff warnings.

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
Terminates with the standard 17-point remediation report specified in [Agent Operating Model](../../../docs/governance/AGENT_OPERATING_MODEL.md).
