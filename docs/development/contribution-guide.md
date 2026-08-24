# LegacyExodus Contribution Guide

Thank you for contributing to **LegacyExodus**.

LegacyExodus is a deterministic, compiler-style static analysis and modernization engine running natively on **Bun**. We prioritize **mathematical correctness, evidence integrity, minimal changes, determinism, and preservation of existing conservative boundaries**.

---

## 1. Prerequisites & Environment

* **Runtime:** [Bun](https://bun.sh) version `>=1.3.0` (Native execution environment)
* **Language:** TypeScript 5.x (Strict mode enabled)
* **Version Control:** Git

Verify your local environment:
```bash
bun --version    # Expected: >=1.3.0
git --version
```

---

## 2. Repository Structure & Execution Context

LegacyExodus enforces a clear boundary between the repository container and the application package root:

```text
LegacyExodus/                          <-- Git Repository Root (Workspace Container)
├── .git/
├── CHANGELOG.md
├── GOVERNANCE.md
├── README.md
├── ROADMAP.md
├── docs/                              <-- Comprehensive Platform Documentation
└── legacy-exodus-core/                <-- Canonical Package Root
    ├── package.json
    ├── tsconfig.json
    ├── src/                           <-- Core Engine Source
    ├── tests/                         <-- Unit & Integration Test Suites
    └── benchmarks/                    <-- Deterministic Benchmark Harness & Corpora
```

> **Execution Invariant:**
> All primary build, test, and typecheck commands run from within `legacy-exodus-core/`.

---

## 3. Development Workflow

### 3.1 Initial Setup
```bash
cd legacy-exodus-core
bun install
```

### 3.2 Running the Test Suite
All unit and integration tests must pass cleanly:
```bash
# Run full test suite with coverage
bun test

# Run tests in watch mode during development
bun test:watch

# Run a specific focused test file
bun test tests/unit/symbols/destructuring-pattern-symbols.test.ts
```

### 3.3 Static Type Checking
LegacyExodus strictly forbids `any` types and loose typing:
```bash
bun run typecheck
```

### 3.4 Benchmark & Governance Verification
Before submitting any changes affecting the engine, flow, or discovery layers, run the benchmark self-audit:
```bash
bun run benchmark audit
```

### 3.5 Formatting & Whitespace Verification
Ensure no trailing whitespace or patch formatting issues exist:
```bash
git diff --check
```

---

## 4. Engineering Principles & Controlled Workflow

Every contribution must follow the **Controlled Engineering Discipline**:

$$\text{RECONNAISSANCE} \longrightarrow \text{FAILURE-FIRST TEST} \longrightarrow \text{MINIMAL FIX} \longrightarrow \text{REGRESSION} \longrightarrow \text{EVIDENCE REPORT}$$

1. **Failure-First Test:** Before modifying production code, write a minimal failing test that proves the issue against the current baseline.
2. **Minimal Fix:** Implement the smallest justified change in `src/` to make the test pass without refactoring unrelated code.
3. **Conservative Semantics:** When static evidence is insufficient, resolve conservatively (e.g. dynamic properties $\to$ `UNRESOLVED`, external imports $\to$ `null`). Never fabricate relationships.
4. **Three-Universe Model Integrity:** Never alter metric classifications to hide unverified predictions or inflate precision. Unmatched sample predictions must remain `UNVERIFIED_SCOPED`.
5. **Preserve Migration Safety Semantics:** Whole-repository migration safety must remain strictly `MIGRATION_SAFETY_NOT_YET_ESTABLISHED` unless exhaustive whole-repository ground truth is proven.

---

## 5. Definition of Done Checklist

Before submitting a Pull Request, confirm that:
- [ ] **Typecheck Clean:** `bun run typecheck` returns exit code `0` with 0 errors.
- [ ] **Tests Passing:** `bun test` passes 100% with 0 regressions.
- [ ] **Governance Green:** `bun run benchmark audit` returns `10 / 10 checks passed (PASS)`.
- [ ] **Whitespace Clean:** `git diff --check` returns 0 whitespace errors.
- [ ] **No Speculative Code:** Implementation solves verified requirements without premature abstractions.
- [ ] **Documentation Synchronized:** Any changes to capabilities, metrics, or invariants are documented in `CHANGELOG.md`, `ROADMAP.md`, and relevant architecture docs.
- [ ] **Code of Conduct:** All contributions adhere to the **[Code of Conduct](../../CODE_OF_CONDUCT.md)**.
