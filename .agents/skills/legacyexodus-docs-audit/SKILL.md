---
name: legacyexodus-docs-audit
description: Methodology for auditing, synchronizing, and verifying LegacyExodus technical documentation against current implementation truth.
---

# Skill: LegacyExodus Documentation Audit

## 1. Purpose
This skill defines the methodology for auditing technical documentation within `docs/` and root markdown files against current executable reality (`legacy-exodus-core`), identifying documentation drift, stale claims, broken cross-references, and false architecture assertions.

## 2. Scope
Applies to all files in `docs/`, `README.md`, `GOVERNANCE.md`, `CONTRIBUTING.md`, and ADRs.

## 3. When to Use
* Auditing documentation after a major code release or toolchain upgrade.
* Detecting drift between CLI command behavior and user documentation.
* Verifying that architecture documents distinguish implemented features from target architecture.
* Checking markdown link integrity, diagram accuracy, and navigation taxonomy.

## 4. When NOT to Use
* Core code remediation or test fixes (use `legacyexodus-forensic-remediation`).
* Restructuring the entire documentation tree without evidence or maintainer consensus.
* Modifying `legacy-exodus-core` implementation files.

## 5. Prerequisites
* Authoritative source knowledge: Use Git queries against `core-foundation` or `main` to inspect the true implementation state:
  ```bash
  git show core-foundation:legacy-exodus-core/src/...
  ```
* **Strict Prohibition:** Do NOT use the stale `legacy-exodus-core` snapshot inside `docs-foundation` as implementation truth.

## 6. Information Architecture Philosophy: Diátaxis Alignment
LegacyExodus documentation is structured around the **Diátaxis framework** (Tutorials, How-To Guides, Technical Reference, Explanation/Architecture):
* Do NOT invent or impose a new information architecture without explicit maintainer consensus.
* Use Diátaxis as an **information-design principle for content clarity**, NOT as an excuse to arbitrarily relocate or rename existing files.
* Respect the existing file locations defined in [`docs/DOCUMENTATION_MAP.md`](../../../docs/DOCUMENTATION_MAP.md).

## 7. Operating Procedure

### Step 1: Executable Truth Discovery
* Inspect the live CLI commands and help text:
  ```bash
  bun run src/cli/index.ts --help
  ```
* Inspect exported public API contracts and schemas in `legacy-exodus-core/src/contracts/`.
* Inspect active test suites to verify actual capabilities.

### Step 2: Documentation Comparison
Compare documented claims against verified execution:
1. **Architecture Status Verification:** Does the document describe `TARGET ARCHITECTURE` (e.g., Rust engine, UIR/SSA, AI Gateway, ZelvoxForge, VymosGate) as `IMPLEMENTED`? If so, flag as critical drift.
2. **CLI & Flag Parity:** Do documented CLI options match actual `commander` declarations in `src/cli/commands/`?
3. **API & Interface Parity:** Do code snippets in documentation use valid TypeScript matching current function signatures?
4. **Link & Reference Audit:** Check that internal markdown links resolve to valid, existing paths.
5. **Diagram Accuracy:** Inspect Mermaid diagrams to ensure component names and relationships reflect live subsystems.

### Step 3: Flagging Defect Categories
Classify documentation defects into one of eight categories:
* **STALE_CLAIM:** Documentation claims behavior that has changed or been deprecated.
* **ARCH_INFLATION:** Future roadmap or target architecture presented as currently implemented.
* **BROKEN_REFERENCE:** Dead link, broken anchor, or missing target file.
* **INCORRECT_EXAMPLE:** Code sample fails typecheck or uses invalid runtime arguments.
* **OMISSION:** New verified subsystem or CLI command lacks reference documentation.
* **DUPLICATION:** Contradictory explanations of the same concept across multiple pages.
* **FLUFF / VAGUE:** Content that contains empty marketing prose without actionable technical details.
* **NAVIGATION_GAP:** Document is orphaned and unlinked in `docs/DOCUMENTATION_MAP.md`.

### Step 4: Documentation Audit Report
Output findings using the standardized audit table:

| Document Path | Line(s) | Category | Documented Claim | Executable Reality | Recommended Fix |
| :--- | :---: | :--- | :--- | :--- | :--- |
| `docs/...` | L45 | ARCH_INFLATION | "Universal IR transforms JS to Rust" | Universal IR is `TARGET ARCHITECTURE` | Add explicit `TARGET ARCHITECTURE` label |

### Step 5: Review Reconciliation & Stacked-PR Review-Base Rule
When reconciling external review comments (e.g., CodeRabbit) on documentation PRs:
1. **Review Findings as Evidence Candidates:** External comments are hypotheses to verify, never direct mandates. Never apply autofixes blindly.
2. **Stacked-PR / Review-Base Invariant:** When a documentation PR documents behavior introduced by an unmerged or concurrent core PR, the PR's base branch (often `main`) may lack recent core commits. Automated reviewers comparing against `main` can report false positives:
   * **Required Procedure:**
     1. Identify the specific implementation claim challenged by the review.
     2. Inspect the authoritative core trunk: `git show origin/core-foundation:<path>`.
     3. Verify ancestry of relevant core implementation commits: `git merge-base --is-ancestor <commit> origin/core-foundation`.
     4. Classify the review finding into one of four states:
        * **`CONFIRMED`**: Legitimate documentation defect where prose or diagrams contradict verified core reality. Apply minimal, surgical docs correction.
        * **`STALE REVIEW CONTEXT`**: Reviewer compared docs against a stale base (e.g., `main`); authoritative `origin/core-foundation` already implements and verifies the claim. Do NOT rewrite docs to match stale base.
        * **`PARTIAL`**: Implementation matches core intent but minor phrasing clarification is warranted without altering architectural semantics.
        * **`CORE/DOCS MISMATCH`**: Documentation specifies intended contract but authoritative core code does not implement it. Report immediately as an implementation finding; do NOT silently rewrite docs to weaken contracts and do NOT mutate core files.
3. **Docs-Only Review Scope:** Documentation review tasks have `docs/**` as writable scope. Core engine files (`legacy-exodus-core/**`) are strictly READ-ONLY. If a reviewer requests production engine changes, report it as a core-side issue and make zero modifications to core files.
4. **PR Description / Metadata Warnings:** Review comments requesting additional PR template sections or metadata do not authorize repository file changes. Provide suggested description additions in the task report only.

---

## 8. Verification & Hygiene
Before committing any documentation fix:
* Verify git diff hygiene: `git diff --check`.
* Verify that no files under `legacy-exodus-core/` were touched.
* Verify that all links in modified markdown files point to valid targets.

## 9. Prohibited Behavior
* Never copy `legacy-exodus-core` into `docs-foundation` merely to synchronize code snapshots.
* Never merge `main` into `docs-foundation` without explicit maintainer directive.
* Never represent planned features as implemented.
* Never delete historical records without consensus.
* Never rewrite accurate documentation to satisfy a stale review base lacking recent core commits.
* Never modify `legacy-exodus-core/` during a documentation review task.
* Never apply external reviewer autofixes without verifying against `origin/core-foundation`.
