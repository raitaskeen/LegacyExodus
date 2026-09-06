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
* **Adversarial Mandate:** The Red-Team Reviewer MUST approach the code with healthy skepticism, assuming the fix is incomplete until proven otherwise.
* **Strict Prohibition:** The Red-Team Reviewer **MUST NOT modify production code or tests** during the review. Its role is exclusively investigative and evaluative.
* **The External Reviewer Axiom:**
  > **"An external reviewer (such as Grok, CodeRabbit, or an adversarial subagent) can challenge or disprove a finding, but cannot close a finding."**

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

### Step 1: Diff & Blast Radius Inspection
* Review the git diff: `git diff HEAD~1`.
* Verify that only files directly related to the finding were touched.

### Step 2: Test Strength Audit
* Inspect the newly added regression test(s):
  * Are assertions strict (`toBe()` / `toEqual()`) or loose (`toBeTruthy()`)?
  * Does the test verify the negative condition as well as the positive?
  * Was the test executed against the unpatched code to verify that it fails first?

### Step 3: Adversarial Counter-Example Construction
* Formulate a minimal code scenario designed to break the proposed fix:
  * Example: If the fix isolates function expressions, test curried arrow functions, method shorthands, and getter/setter methods.

### Step 4: Verification Gate Audit
* Execute the verification gate:
  ```bash
  bun run verify
  ```
* Ensure that all 4 gates pass without warnings.

### Step 5: Verdict Generation
Issue an explicit verdict:
* **`RED-TEAM FAIL`**: Concrete defect, unhandled counter-example, or weakened test identified. The cycle returns to the Builder with reproduction details.
* **`RED-TEAM PASS`**: All 11 questions answered satisfactorily, verified by evidence.

---

## 8. Expected Red-Team Review Report Schema
Every red-team review MUST conclude with this standardized report:

```markdown
### RED-TEAM ADVERSARIAL REVIEW REPORT

* **Candidate Commit / PR:** <Commit SHA or PR Number>
* **Reviewed Finding:** <Finding ID & Title>
* **Reviewer Persona:** Red-Team Adversarial Reviewer

#### 1. Adversarial Analysis & Probing Summary
- [x] Tested boundary and negative cases.
- [x] Verified assertions are strict and non-vacuous.
- [x] Confirmed determinism across repeated executions.
- [x] Verified zero scope creep and minimal diff size.

#### 2. Counter-Examples Evaluated
[List specific code patterns tested against the fix and their outcomes]

#### 3. Unresolved Risks or Gaps
[Any remaining edge cases, memory concerns, or test limitations]

#### 4. Final Verdict
**RED-TEAM PASS** | **RED-TEAM FAIL**

#### 5. Rationale & Next Actions
[Actionable explanation of the verdict]
```
