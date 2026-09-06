---
name: legacyexodus-code-audit
description: Read-only static analysis and deep architectural code audit methodology for LegacyExodus core subsystems.
---

# Skill: LegacyExodus Code Audit

## 1. Purpose
This skill defines the read-only audit procedure for inspecting, evaluating, and identifying latent defects, correctness flaws, security vulnerabilities, memory bottlenecks, and determinism risks within the `legacy-exodus-core` codebase.

## 2. Scope
Applies to all source files, contracts, AST mappers, flow analyzers, graph builders, storage engines, runtime lifecycles, and CLI commands in `legacy-exodus-core/`.

## 3. When to Use
* Auditing an existing subsystem for correctness, edge-case coverage, or memory safety.
* Investigating an external CodeRabbit or static analysis warning before remediation.
* Performing a scheduled architectural review of data flow, taint analysis, or graph resolution.
* Reviewing security boundaries (command injection, path traversal, untrusted input).

## 4. When NOT to Use
* Implementing code changes or bug fixes (use `legacyexodus-forensic-remediation`).
* Auditing documentation files or markdown guides (use `legacyexodus-docs-audit`).
* Performance profiling without code inspection (use `legacyexodus-performance-audit`).

## 5. Prerequisites
* **Strictly READ-ONLY operating authority.**
* Local Git repository initialized on the current authoritative branch (`main` or `core-foundation`).
* Understanding of the 14 active subsystems defined in [Permanent Charter](../../../docs/governance/PERMANENT_CHARTER.md).

## 6. Operating Procedure

### Step 1: Subsystem Boundary & Contract Identification
* Identify the target subsystem and its explicit architectural invariants:
  * **Discovery:** Inventory reconciliation invariant ($\text{Discovered} = \text{Categorized} + \text{Analyzed} + \text{Failed} + \text{Unsupported} + \text{Excluded}$).
  * **Parser:** Babel AST normalization and source location tracking.
  * **Symbols:** Lexical scoping, `var` hoisting, parameter shadowing, CommonJS export bindings.
  * **Graph:** ESM/CJS dependency resolution, cyclic barrel handling, re-export unwrapping.
  * **Semantic:** Lexical bare calls vs. receiver-based member calls, receiver invalidation.
  * **Flow (CFG/DFG):** Basic block completeness, destructuring pattern coverage, interprocedural taint propagation.
  * **Storage:** SQLite run isolation (`projectId`, `analysisRunId`), transaction boundaries (`BEGIN IMMEDIATE`).
  * **Runtime:** Idempotent `shutdown()`, event bus subscriber error isolation.
  * **Security:** `spawn()` with `shell: false`, path traversal defense, Windows batch file prohibition.

### Step 2: Static Analysis & Code Traversal
* Perform targeted inspection using ripgrep (`grep_search`), AST inspection, and cross-file reference tracking.
* Inspect edge cases:
  * What happens with empty, null, or deeply nested AST inputs?
  * How are circular references, self-imports, or recursive barrels handled?
  * Are object references held in long-lived caches or arrays across analysis cycles?
  * Are promises handled safely without unhandled rejections during error paths?

### Step 3: Verification Against Existing Test Contracts
* Check if tests exist covering the inspected path:
  ```bash
  bun test tests/unit/<subsystem>/
  ```
* Review test assertions: do they test exact values or merely non-empty results?

### Step 4: Formulate Reproduction & Root Cause Hypothesis
* Construct a minimal, reproducible code snippet or execution pattern demonstrating the defect.
* Trace the flaw to the exact line and underlying structural reason.

### Step 5: Document Findings
* Compile every identified issue into the standardized finding format.

---

## 7. Standard Finding Report Schema
Every discovered issue MUST be reported using this exact schema:

```markdown
### FINDING: [Finding-ID] — <Concise Descriptive Title>

- **Severity:** P0 | P1 | P2 | P3
- **Confidence:** CONFIRMED | LIKELY | POSSIBLE | DESIGN QUESTION
- **Subsystem:** Discovery | Parser | Symbols | Graph | Semantic | Flow | Storage | Runtime | CLI | Security
- **Location:** `legacy-exodus-core/src/<path>/<file>.ts:L<start>-L<end>`

#### 1. Observed Behavior & Evidence
[Explain the code flaw citing exact lines, data structures, and failure conditions]

#### 2. Root Cause Analysis
[Explain WHY the flaw exists structurally or algorithmically]

#### 3. Concrete Impact
[Impact on analysis correctness, security vulnerability, determinism, or memory scalability]

#### 4. Minimal Reproduction Scenario
\`\`\`typescript
// Minimal code reproducing the unexpected behavior
\`\`\`

#### 5. Recommended Remediation
[The smallest clean, correct architectural fix that addresses root cause]

#### 6. Verification Plan
[Specific automated regression tests required to verify the fix]

#### 7. Status
[DISCOVERED | VALIDATING | CONFIRMED | NOT_REPRODUCED | REJECTED]
```

---

## 8. Prohibited Behavior
* **NEVER edit source files or tests during a code audit.**
* NEVER report cosmetic style preferences as functional bugs.
* NEVER hallucinate defects based on assumptions; every finding must be backed by live code inspection.
* NEVER dismiss an external finding without inspecting the live repository source.
