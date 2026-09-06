# LegacyExodus: Primary Operating Instructions for AI Agents
## Canonical Engineering & Governance Directives for All AI Coding Assistants

*Status: Authoritative & Active*
*Scope: Root (`LegacyExodus/`)*
*Jurisdiction: All AI Coding Agents, Copilots, Autonomous Assistants, and Reviewers*

---

## 1. The Governing Axiom

> **EVIDENCE → FAILURE-FIRST TEST → ROOT CAUSE → SMALLEST SAFE CHANGE → STATIC TYPECHECK → FOCUSED TEST → FULL TEST → BENCHMARK AUDIT → DETERMINISM → RED TEAM → DIFF REVIEW → COMMIT → PUSH → STOP**

This is the governing axiom for all LegacyExodus forensic remediation. The repository enforces a single, authoritative, non-negotiable remediation sequence. For the exact, deterministic 20-step sequence of execution, all agents MUST follow the **Canonical Forensic Remediation Sequence** in [`docs/governance/AGENT_OPERATING_MODEL.md`](docs/governance/AGENT_OPERATING_MODEL.md#41-canonical-forensic-remediation-sequence). You MUST NOT reorder, abbreviate, or bypass this sequence, nor define a competing workflow.

For detailed constitutional standards and multi-agent roles, refer to:
* **Constitutional Charter:** [`docs/governance/PERMANENT_CHARTER.md`](docs/governance/PERMANENT_CHARTER.md)
* **Agent Operating Model:** [`docs/governance/AGENT_OPERATING_MODEL.md`](docs/governance/AGENT_OPERATING_MODEL.md)
* **Repository Skills:** [`.agents/skills/`](.agents/skills/)

---

## 2. Core Operational Rules (Mandatory)

### A. AUTHORITY & TRUTH PRECEDENCE
Current implementation source code is the **sole primary truth**. A document does NOT override executable reality.

When resolving discrepancies, enforce this strict precedence order:
1. **Current Production Code** (authoritative implementation on `core-foundation`: `legacy-exodus-core/src/`)
2. **Current Automated Tests** (`legacy-exodus-core/tests/`)
3. **Current CI Verification Gates** (`.github/workflows/ci.yml`)
4. **Current Concrete Architecture** (live component maps)
5. **Accepted ADRs** (`docs/adr/`)
6. **Current Documentation** (`docs/`)
7. **Historical Documentation & Archives**
8. **Drafts, Plans, & Research Proposals**

If documentation states a feature exists but no working code is integrated into `legacy-exodus-core/src/`, the feature is **NOT IMPLEMENTED**.

**Documentation Truth Rule:** For documentation work, agents MUST resolve implementation and test truth directly from the core trunk via branch-qualified Git commands:
* **Implementation Source Code:**
  ```bash
  git show core-foundation:legacy-exodus-core/src/<path>
  ```
* **Automated Test Suites & Regression Proofs:**
  ```bash
  git show core-foundation:legacy-exodus-core/tests/<path>
  ```

Agents are strictly prohibited from treating the stale snapshot at `docs-foundation/legacy-exodus-core/` as current truth. This prohibition applies equally to:
* Implementation source code (`legacy-exodus-core/src/`)
* Automated test suites and regression fixtures (`legacy-exodus-core/tests/`)
* Benchmark harnesses, configurations, and test data

Under no circumstances should tests or source from the stale snapshot inside `docs-foundation` be treated as authoritative evidence. The truth hierarchy is strictly:
$$\text{Current } \texttt{core-foundation} \text{ implementation} \longrightarrow \text{Current } \texttt{core-foundation} \text{ tests/evidence} \longrightarrow \text{Current documentation}$$

When documentation verification requires source or test inspection, agents MUST use branch-qualified commands (`git show core-foundation:<path>`) consistently. NEVER copy the current core into `docs-foundation` or merge `main` into `docs-foundation` merely to synchronize the stale snapshot.

---

### B. ARCHITECTURE TRUTH & STATE LABELS
Every architecture claim, subsystem description, and PR summary MUST classify features into exactly one of these seven explicit states:

* **`IMPLEMENTED`**: Code exists and is integrated into the active runtime.
* **`VERIFIED`**: Implemented AND proven by passing tests and benchmark audits.
* **`PARTIAL`**: Working implementation exists, but coverage or edge-case handling is incomplete.
* **`EXPERIMENTAL`**: Code exists behind flags or is not yet stable.
* **`PLANNED`**: Concrete design or ADR exists, but zero implementation code exists.
* **`TARGET ARCHITECTURE`**: Long-term future direction (e.g., Rust/Axum rewrite, UIR/SSA lowerings, ZelvoxForge, VymosGate, AI Gateway).
* **`NOT IMPLEMENTED`**: No working code exists in the repository.

**Absolute Rule:** NEVER describe `PLANNED`, `TARGET ARCHITECTURE`, or `NOT IMPLEMENTED` as implemented functionality.

---

### C. AGENT ROLES & FINDING DISCIPLINE

#### 1. Remediation Agents (`legacyexodus-forensic-remediation`)
Remediation agents (Builders) have scoped mutation authority and MUST process exactly **one finding at a time**, executing the single **Canonical Forensic Remediation Sequence** defined in [`docs/governance/AGENT_OPERATING_MODEL.md`](docs/governance/AGENT_OPERATING_MODEL.md#41-canonical-forensic-remediation-sequence). They do NOT define an independent or competing sequence. Key responsibilities include:
1. Validating clean worktree preconditions before starting.
2. Formulating a failure-first minimal reproduction and RED test prior to any code modification.
3. Applying the smallest safe architectural change that addresses root cause.
4. Passing all verification gates (focused test, static typecheck, full test suite, benchmark audit, CLI smoke test).
5. Undergoing adversarial Red-Team review gate (Step 13) and resolving any counter-examples by returning to Step 7.
6. Performing diff and scope hygiene review (Step 14).
7. Compiling draft verification report with pending operations explicitly marked PENDING (Step 15).
8. Performing atomic conventional commit and remote push (Steps 16–17).
9. Verifying post-push clean worktree and producing final completion report with zero PENDING placeholders (Steps 18–19).
10. Mandatory hard stop upon push and postcondition verification (Step 20).

#### 2. Review, Audit & Research Agents (`legacyexodus-code-audit`, `legacyexodus-docs-audit`, `legacyexodus-performance-audit`, `legacyexodus-red-team-review`)
All four review and audit skills operate in a strictly **non-destructive, read-only** (or challenge-only) capacity.

ALL FOUR review/audit skills:
1. **MUST NOT** modify files.
2. **MUST NOT** create RED regression tests.
3. **MUST NOT** commit.
4. **MUST NOT** push.

Role boundaries are strictly partitioned:
* **`legacyexodus-code-audit` (Code Audit):** Strictly read-only inspection of source code, AST contracts, and execution logic.
* **`legacyexodus-docs-audit` (Docs Audit):** Strictly read-only comparison of documentation claims against executable truth.
* **`legacyexodus-performance-audit` (Performance Audit):** Strictly read-only measurement and profiling of runtime speed, memory scalability, and benchmarks.
* **`legacyexodus-red-team-review` (Red Team Review):** Strictly read-only and challenge-only adversarial probing of candidate diffs and regression evidence.

They can inspect, measure, challenge, report, and provide evidence.
They cannot remediate.
They cannot close findings.
They cannot commit or push.
The Builder / Remediation Agent remains the writing authority.
The Human Maintainer remains the final authority.

---

### D. NO FALSE CLOSURE
**Passing tests are evidence, not proof.** A finding can only be declared closed when:
* The root cause is addressed.
* Dedicated regression coverage exists where appropriate.
* Focused and full test suites pass 100%.
* Benchmark governance passes 10/10.
* Diff is reviewed and hygiene is verified.

If evidence is incomplete, report:
`INCONCLUSIVE` | `SAFE WITH REQUIRED FOLLOW-UP` | `BLOCKED`

**Never upgrade uncertainty into certainty.**

---

### E. NO TEST WEAKENING (ZERO TOLERANCE)
You MUST NEVER:
* Delete existing tests to make a suite pass.
* Weaken assertion thresholds or replace exact equality with loose checks (`toBeTruthy`).
* Increase benchmark tolerances solely to hide regressions.
* Skip tests via `.skip` or commenting out assertions.
* Suppress type errors with `@ts-ignore`, `@ts-expect-error`, or `any` casts.
* Disable strict compiler settings in `tsconfig.json`.

Tests are an immutable part of the specification.

---

### F. CORE & DOCUMENTATION SEPARATION
* **Core Remediation Boundary:** Work in `legacy-exodus-core/` MUST NOT modify `README.md`, `CHANGELOG.md`, `docs/`, or marketing content unless technically required for build correctness.
* **Branch Separation:** Core engineering belongs to `core-foundation` (or task branches). Documentation belongs to `docs-foundation`.
* **Stale Snapshot Isolation:** The stale copy of `legacy-exodus-core` inside `docs-foundation` is NOT implementation truth. For documentation work, query core source via Git:
  ```bash
  git show core-foundation:legacy-exodus-core/src/<path>
  ```
* NEVER copy `legacy-exodus-core` into `docs-foundation` merely to synchronize snapshots.

---

### G. GIT SAFETY & BRANCH INTEGRITY
* **Never commit directly to `main`.**
* **Never force-push (`git push -f`) shared branches.**
* **Permanent Branches:** Exactly three permanent branches exist: `main`, `core-foundation`, `docs-foundation`.
* **No Branch Sprawl:** Do NOT create permanent branches named `skills`, `agent-governance`, `skill.md`, etc. All work occurs on temporary task branches (`fix/*`, `feat/*`, `chore/*`).
* **Clean Tree Requirement:** Before and after every task, `git status` MUST report `nothing to commit, working tree clean`.

---

### H. SECRETS & CREDENTIAL HYGIENE
* NEVER print, log, commit, or expose API keys, tokens, passwords, private keys, or credentials.
* If a command, file, or log contains sensitive credentials, REDACT them immediately.

---

## 3. Specialized Skills Quick Reference

When performing specific tasks, invoke the corresponding repository skill in `.agents/skills/`:

| Skill | Purpose | Key Procedure |
| :--- | :--- | :--- |
| [`legacyexodus-forensic-remediation`](.agents/skills/legacyexodus-forensic-remediation/SKILL.md) | Bug fixing & finding remediation | Red test $\to$ Smallest fix $\to$ Verify $\to$ Commit $\to$ Stop |
| [`legacyexodus-code-audit`](.agents/skills/legacyexodus-code-audit/SKILL.md) | Read-only code & security inspection | Non-destructive audit $\to$ Standard finding schema |
| [`legacyexodus-docs-audit`](.agents/skills/legacyexodus-docs-audit/SKILL.md) | Docs vs code truth reconciliation | Source comparison $\to$ Flag drift & arch inflation |
| [`legacyexodus-git-governance`](.agents/skills/legacyexodus-git-governance/SKILL.md) | Branch, commit, and push rules | 3 permanent branches $\to$ Clean tree $\to$ Conventional Commits |
| [`legacyexodus-test-verification`](.agents/skills/legacyexodus-test-verification/SKILL.md) | Multi-gate test verification | 10-layer verification hierarchy from unit to composite gate |
| [`legacyexodus-performance-audit`](.agents/skills/legacyexodus-performance-audit/SKILL.md) | Performance & memory profiling | Baseline $\to$ 3 runs $\to$ Bounded $O(\text{window})$ memory audit |
| [`legacyexodus-red-team-review`](.agents/skills/legacyexodus-red-team-review/SKILL.md) | Adversarial challenge & edge cases | 11 probing questions $\to$ Red-team pass/fail verdict |

---

## 4. Mandatory Stop Conditions
An agent MUST immediately halt execution, report results, and await human instructions when:
1. The assigned finding or task is fully remediated, verified, committed, and pushed.
2. An unexpected test failure or compiler break occurs in unrelated files.
3. An architectural invariant appears broken or contradictory.
4. Tooling or runtime environments return fatal unexpected errors.
5. The working tree is clean and the verification pipeline has succeeded.

**Never "keep going" to the next task without explicit instruction.**
