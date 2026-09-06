---
name: legacyexodus-test-verification
description: 10-layer test and verification hierarchy, gate execution protocols, and anti-test-weakening standards for LegacyExodus.
---

# Skill: LegacyExodus Test & Verification

## 1. Purpose
This skill defines the multi-tiered verification hierarchy required to certify code changes in LegacyExodus. It ensures that every change is validated from narrow regression assertions up through composite repository verification gates.

## 2. Scope
Applies to all code, test, benchmark, and dependency changes in `legacy-exodus-core/`.

## 3. When to Use
* Verifying a bug fix or feature implementation during the remediation cycle.
* Running pre-commit and pre-push quality checks.
* Certifying dependency upgrades and toolchain changes.
* Investigating test flakiness or non-deterministic test failures.

## 4. When NOT to Use
* Pure documentation edits that do not touch code or tests (use `legacyexodus-docs-audit`).

## 5. The 10 Verification Layers
LegacyExodus defines 10 verification layers. Any skipped layer MUST be explicitly justified in the final task report:

```text
Layer 1:  FOCUSED REGRESSION TEST  ──► Reproduces defect and proves the fix.
Layer 2:  RELEVANT SUBSYSTEM SUITE ──► Validates direct callers and sibling components.
Layer 3:  FULL TEST SUITE          ──► All 113+ files and 1,000+ tests (bun test).
Layer 4:  STATIC TYPECHECK         ──► Zero TypeScript errors (tsc --noEmit).
Layer 5:  BENCHMARK AUDIT          ──► 10/10 governance checks (bun run benchmark audit).
Layer 6:  DETERMINISM AUDIT        ──► Multi-run identical output verification (--runs 3).
Layer 7:  COMPOSITE VERIFY GATE    ──► All 4 gates pass (bun run verify).
Layer 8:  CLI SMOKE TEST           ──► CLI starts cleanly (bun run src/cli/index.ts --help).
Layer 9:  GIT DIFF HYGIENE         ──► Zero whitespace or diff corruption (git diff --check).
Layer 10: CLEAN TREE AUDIT         ──► Working tree clean (git status).
```

---

## 6. Operating Procedure

### Layer 1: Focused Regression Test
Run the specific test file covering the modified component:
```bash
bun test tests/unit/subsystem/target.test.ts
```
* Confirm that the test executes and passes cleanly.

### Layer 2: Subsystem Suite
Run all tests in the associated architectural domain:
```bash
bun test tests/unit/flow/
```

### Layer 3: Full Test Suite
Execute the entire test suite:
```bash
bun test
```
* Record total tests, files, and expect() assertion calls.
* All tests MUST pass (0 failures).

### Layer 4: Static Typecheck
Execute compiler verification:
```bash
bun run typecheck
```
* Output MUST indicate zero compiler errors.

### Layer 5: Benchmark Governance Audit
Run the 10-point governance benchmark audit:
```bash
bun run benchmark audit
```
* Output MUST report `Verdict: PASS` with `10/10 checks verified`.

### Layer 6: Determinism Audit
Verify that repeated runs produce bit-for-bit identical outputs:
```bash
bun run benchmark run express --runs 3
```

### Layer 7: Composite Verify Gate
Execute the automated 4-gate verification dashboard:
```bash
bun run verify
```
* Verifies: Static Typecheck, Test Suite, Benchmark Governance, and Git Hygiene.

### Layer 8: CLI Smoke Test
Confirm that the executable entry point compiles and executes:
```bash
bun run src/cli/index.ts --help
```

### Layer 9: Git Diff Hygiene
Verify diff formatting:
```bash
git diff --check
```

### Layer 10: Clean Tree Audit
Confirm that no untracked artifacts, cache directories, or temp files were left behind:
```bash
git status
```

---

## 7. Anti-Test-Weakening Policy (Strict Prohibitions)
1. **Zero Test Deletion:** Deleting an existing test is strictly forbidden.
2. **Zero Assertion Widening:** Modifying an `expect(x).toBe(10)` to `expect(x).toBeGreaterThan(0)` to hide a regression is a catastrophic violation.
3. **Zero Test Skipping:** Adding `test.skip`, `describe.skip`, or commenting out assertions is prohibited.
4. **Zero Type Suppression:** Introducing `@ts-ignore` or `@ts-expect-error` to pass typechecking is prohibited.

## 8. Expected Report Schema
The test verification summary MUST document:
* **Files Tested:** Total test file count.
* **Pass / Fail Count:** Exact counts (e.g., 1001 pass, 0 fail).
* **Assertion Calls:** Number of expect() calls executed (e.g., 9388).
* **Typecheck Status:** Pass/Fail and duration.
* **Benchmark Verdict:** Pass/Fail and checks count.
* **Skipped Layers Justification:** Explicit reason if any layer was omitted.
