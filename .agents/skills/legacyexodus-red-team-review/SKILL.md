---
name: legacyexodus-red-team-review
description: Adversarial review methodology for challenging implementations, exposing false confidence, and validating test invariants.
---

# Skill: LegacyExodus Red-Team Review

## 1. Purpose
This skill defines the adversarial red-team review process for LegacyExodus. Its mission is to challenge proposed code changes, invalidate superficial tests, expose unhandled edge cases, and ensure that remediations fix true root causes rather than mask symptoms.

## 2. Scope
Applies to Pull Requests, bug remediations, architectural refactors, and external audit challenges (e.g., CodeRabbit, Grok, Copilot) across all subsystems.

## 3. When to Use
* Reviewing an agent's proposed remediation before merging.
* Auditing new unit or integration tests for false confidence or weak assertions.
* Challenging architectural claims and verifying edge-case resilience.
* Evaluating external bot criticisms to establish true defect validity.

## 4. When NOT to Use
* Implementing code fixes (use `legacyexodus-forensic-remediation`).
* Running standard read-only audits without adversarial challenge (use `legacyexodus-code-audit`).

## 5. Operating Authority & Boundaries
* **Strict Read-Only & Challenge-Only Mandate:** Red Team Review operates in a strictly **read-only and challenge-only** capacity.
* **Workflow Preparation vs. Auditor Execution Partition:**
  * Potentially mutating verification commands (e.g., `bun run verify`, which executes `bun test --coverage` writing coverage reports, and `bun run benchmark audit` deleting/writing `.discovery` cache artifacts) MUST execute ONLY in an isolated verification checkout/workspace prepared by the invoking workflow or Human Maintainer.
  * The Red-Team reviewer workspace itself remains strictly read-only. Commands known to mutate `coverage/`, benchmark discovery artifacts (`.cache/`, `.discovery`), temporary files, or other repository state MUST NEVER execute directly within the Red-Team inspection workspace.
* **Strict Invariants:**
  1. **MUST NOT** modify files.
  2. **MUST NOT** create RED regression tests.
  3. **MUST NOT** commit.
  4. **MUST NOT** push.
* **Adversarial Mandate:** The Red-Team Reviewer MUST approach the candidate change with healthy skepticism, assuming the fix is incomplete until proven otherwise.
* **The External Reviewer Axiom:**
  > **"An external reviewer (such as Grok, CodeRabbit, or an adversarial subagent) can challenge or disprove a finding, but cannot close a finding."**
  A finding is only closed when executable tests and verification gates prove remediation. The Builder / Remediation Agent remains the writing authority; the Human Maintainer remains the final authority.

---

## 6. The 11 Adversarial Probing Questions
The Red Team MUST systematically interrogate the candidate change against these eleven questions:

1. **What assumption could be wrong?** (Did the author assume AST nodes always have identifiers, or that paths are always POSIX?)
2. **What case was not tested?** (What happens with empty files, null literals, cyclic dependencies, or deeply nested callbacks?)
3. **Could the test pass for the wrong reason?** (Does the test assert exact symbol IDs, or merely that an array has length $> 0$?)
4. **Did the implementation address the root cause?** (Did the fix patch an `if` branch at the call site, or correct the underlying scope resolution?)
5. **Did behavior change elsewhere?** (Did this symbol extraction fix break prototype method resolution in another subsystem?)
6. **Did determinism change?** (Does the change introduce un-sorted `Set` iterations or timestamps into output digests?)
7. **Did memory behavior change?** (Are objects being retained in uncleaned closures or maps?)
8. **Did error handling change?** (Are errors swallowed, or does failure cleanly propagate to the domain event stream?)
9. **Did the diff become larger than necessary?** (Did the author refactor untouched functions or reformat unrelated files?)
10. **Is documentation now inaccurate?** (Did a CLI flag change without updating docs, or was target architecture claimed as implemented?)
11. **Is there a hidden toolchain or dependency problem?** (Was `package.json` edited without updating `bun.lock`?)

---

## 7. Operating Procedure

### Step 1: Complete PR Diff & Blast Radius Inspection Against Merge Base
* Resolve the authoritative PR base branch (`origin/core-foundation` for core engineering, `origin/docs-foundation` for documentation, or `origin/main` for integration releases):
  ```bash
  BASE_BRANCH="origin/core-foundation" # resolve to target base
  MERGE_BASE=$(git merge-base $BASE_BRANCH HEAD)
  git diff --stat $MERGE_BASE..HEAD
  git diff $MERGE_BASE..HEAD
  ```
* Inspect the complete PR diff across all candidate commits rather than only the latest commit (`HEAD~1`).
* Verify that strictly the files in scope were touched and zero unrelated refactorings exist.

### Step 2: Test Strength Audit
* Inspect the newly added regression test(s):
  * Are assertions strict (`toBe()` / `toEqual()`) or loose (`toBeTruthy()`)?
  * Does the test verify the negative condition as well as the positive?
  * Was the test executed against the unpatched code to verify that it fails first?

### Step 3: Adversarial Counter-Example Construction
* Formulate a minimal code scenario designed to break the proposed fix:
  * Example: If the fix isolates function expressions, test curried arrow functions, method shorthands, and getter/setter methods.

### Step 4: Verification Gate Audit (Isolated Verification Environment)
* **Precondition:** The invoking workflow or Human Maintainer executes verification within an isolated verification checkout/workspace, or provides verified execution logs from that environment.
* Because `bun run verify` executes test suites that emit coverage output and benchmark audits that mutate cache/discovery artifacts (`.cache/`, `.discovery`), the Red-Team reviewer MUST NOT run mutating verification directly inside its read-only inspection workspace.
* Review the verification gate execution logs from the isolated environment:
  ```bash
  bun run verify
  ```
* Ensure that all 4 gates pass without warnings (Static Typecheck, Test Suite, Benchmark Governance, and Git Working Tree Hygiene).

### Step 5: Verdict Generation
Issue an explicit verdict:
* **`RED-TEAM FAIL`**: Concrete defect, unhandled counter-example, or weakened test identified. The cycle returns to the Builder with reproduction details to execute **Step 7: Apply Smallest Safe Change** of the Canonical Forensic Remediation Sequence (in [`docs/governance/AGENT_OPERATING_MODEL.md`](../../../docs/governance/AGENT_OPERATING_MODEL.md#41-canonical-forensic-remediation-sequence)). The existing minimal reproduction and RED test remain valid and are preserved; the Builder updates the implementation to resolve the counter-example, then re-runs Step 8 (Focused Test Verification) and all downstream verification gates (Steps 9–13).
* **`RED-TEAM PASS`**: All 11 questions answered satisfactorily, verified by evidence. Progression to Step 14 (Diff & Scope Hygiene Review) is authorized.

---

## 8. Expected Red-Team Review Report Schema
Every red-team review MUST conclude with this standardized report. The review is considered INCOMPLETE unless all 11 probing questions contain documented evidence or counterexamples:

```markdown
### RED-TEAM ADVERSARIAL REVIEW REPORT

* **Candidate Commit / PR:** <Commit SHA or PR Number>
* **Reviewed Finding:** <Finding ID & Title>
* **Target Base Branch:** origin/core-foundation | origin/docs-foundation | origin/main
* **Resolved Merge Base:** <Merge Base SHA>
* **Reviewer Persona:** Red-Team Adversarial Reviewer

#### 1. Adversarial Probing of the 11 Questions (Mandatory Evidence per Question)

1. **What assumption could be wrong?**
   - [ ] Probe completed
   - Evidence / counterexample:
   - Verdict: PASS | FAIL

2. **What case was not tested?**
   - [ ] Probe completed
   - Evidence / counterexample:
   - Verdict: PASS | FAIL

3. **Could the test pass for the wrong reason?**
   - [ ] Probe completed
   - Evidence / counterexample:
   - Verdict: PASS | FAIL

4. **Did the implementation address the root cause?**
   - [ ] Probe completed
   - Evidence / counterexample:
   - Verdict: PASS | FAIL

5. **Did behavior change elsewhere?**
   - [ ] Probe completed
   - Evidence / counterexample:
   - Verdict: PASS | FAIL

6. **Did determinism change?**
   - [ ] Probe completed
   - Evidence / counterexample:
   - Verdict: PASS | FAIL

7. **Did memory behavior change?**
   - [ ] Probe completed
   - Evidence / counterexample:
   - Verdict: PASS | FAIL

8. **Did error handling change?**
   - [ ] Probe completed
   - Evidence / counterexample:
   - Verdict: PASS | FAIL

9. **Did the diff become larger than necessary?**
   - [ ] Probe completed
   - Evidence / counterexample:
   - Verdict: PASS | FAIL

10. **Is documentation now inaccurate?**
    - [ ] Probe completed
    - Evidence / counterexample:
    - Verdict: PASS | FAIL

11. **Is there a hidden toolchain or dependency problem?**
    - [ ] Probe completed
    - Evidence / counterexample:
    - Verdict: PASS | FAIL

#### 2. Counter-Examples Evaluated
[List specific code patterns tested against the fix and their outcomes]

#### 3. Unresolved Risks or Gaps
[Any remaining edge cases, memory concerns, or test limitations]

#### 4. Final Verdict
**RED-TEAM PASS** | **RED-TEAM FAIL**

#### 5. Rationale & Next Actions
[Actionable explanation of the verdict]
```
