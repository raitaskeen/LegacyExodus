---
name: legacyexodus-performance-audit
description: Performance measurement methodology, memory scalability profiling, and benchmark regression analysis for LegacyExodus.
---

# Skill: LegacyExodus Performance & Memory Audit

## 1. Purpose
This skill defines the rigorous, empirical methodology for benchmarking execution speed, CPU time, peak memory usage (RSS), garbage collection behavior, and determinism across the LegacyExodus pipeline. It enforces strict standards to prevent fabricated or premature performance claims.

## 2. Scope
Applies to AST parsing, symbol extraction, graph construction, data flow analysis, SQLite projection streaming, and CLI operations in `legacy-exodus-core/`.

## 3. When to Use
* Evaluating performance impacts of new features or algorithm optimizations.
* Profiling memory consumption and whole-repository AST retention ($O(1)$ window vs $O(N)$ whole repo).
* Investigating performance regressions or slowdowns in CI/local runs.
* Auditing toolchain and dependency upgrade impacts (e.g., TypeScript or Bun version changes).

## 4. When NOT to Use
* Standard functional bug fixing without performance impact (use `legacyexodus-forensic-remediation`).
* General code audits (use `legacyexodus-code-audit`).
* Modifying production code, creating red regression tests, or committing changes (use `legacyexodus-forensic-remediation`).

## 5. Operating Authority & Boundaries
* **Strict Read-Only Mandate:** Performance Audit operates in a strictly **read-only** capacity.
* **Workflow Preparation vs. Auditor Execution Partition:**
  * **Workflow Preparation (Invoking Workflow / Human Maintainer Owned):** The invoking workflow or Human Maintainer MUST prepare BOTH isolated workspaces BEFORE the Performance Auditor starts:
    1. **Base Workspace:** An isolated checkout at the exact, unchanged base commit (`origin/core-foundation`, `origin/docs-foundation`, or `origin/main`), ready for baseline benchmarking.
    2. **Candidate Workspace:** An isolated checkout at the exact candidate / remediation commit being evaluated, ready for candidate benchmarking.
  * **Auditor Execution (Performance Auditor Owned):** The performance auditor operates strictly against the pre-prepared base and candidate workspaces. The auditor obtains comparable benchmark and performance metrics from both workspaces and compares candidate metrics against the unchanged base using documented classification thresholds.
* **Strict Invariants:**
  1. **MUST NOT** create either checkout, checkout branches, reset workspaces, merge, rebase, or otherwise change refs.
  2. **MUST NOT** modify files or mutate either workspace.
  3. **MUST NOT** create RED regression tests.
  4. **MUST NOT** commit.
  5. **MUST NOT** push.
Performance auditors measure, benchmark, profile, and report evidence. They cannot remediate defects, cannot close findings, and cannot commit or push. The Builder / Remediation Agent remains the writing authority; the Human Maintainer remains the final authority.

---

## 6. Critical Memory Disclosure Rule
> **"A tiny instantaneous RSS reading does NOT constitute proof of OOM safety. Memory safety is established ONLY by demonstrating bounded working set scaling under heavy workloads."**

Agents MUST explicitly classify memory and performance measurements into one of five states:
1. **`VERIFIED`**: Proven by heap snapshots, GC pressure tests, determinism checks, and stress tests on large corpus.
2. **`INCONCLUSIVE`**: Measurements exhibit variance $> \pm 3.0\%$ across repetitions, environmental interference occurred, or long-term/whole-repository scaling was not established.
3. **`REGRESSION`**: Resource consumption exceeded baseline by more than experimental noise ($\Delta\% > +3.0\%$) or throughput degraded ($\Delta\% < -3.0\%$).
4. **`IMPROVEMENT`**: Reproducible reduction in resource consumption ($\Delta\% < -3.0\%$) or increase in throughput ($\Delta\% > +3.0\%$) under identical conditions.
5. **`NO MATERIAL CHANGE`**: Variance is within normal experimental noise ($-3.0\% \le \Delta\% \le +3.0\%$).

---

## 7. Operating Procedure

### Step 1: Baseline Establishment (Pre-Prepared Base Workspace)
* **Precondition:** The invoking workflow or Human Maintainer has prepared both isolated workspaces (Base Workspace at unchanged base commit, Candidate Workspace at candidate commit). The auditor MUST NOT perform checkout, branch creation, ref switching, or reset operations.
* Run the benchmark suite against the pre-prepared Base Workspace to capture baseline performance:
  ```bash
  bun run benchmark audit
  bun run benchmark run express --runs 3
  ```
* Record the exact base commit SHA / workspace path, median wall time, peak memory, and CPU utilization.

### Step 2: Controlled Environment Preparation
* Close background processes to minimize CPU throttling and memory contention.
* Record hardware, OS, Bun version, and CPU architecture.

### Step 3: Warm-Up & Execution (Pre-Prepared Candidate Workspace)
* Obtain metrics from the pre-prepared Candidate Workspace (without checking out or mutating refs).
* Discard the first cold-start iteration to account for JIT warm-up and filesystem cache priming.
* Execute at least three consecutive measurement runs within the Candidate Workspace:
  ```bash
  bun run benchmark run <target> --runs 3
  ```
* Record the exact candidate commit SHA / workspace path.

### Step 4: Metrics Capture
Record the following parameters:
* **Wall Time (Duration):** Total execution time from start to completion.
* **CPU Time:** User time and system time.
* **Peak RSS:** Peak resident set size observed during analysis.
* **Throughput:** Files analyzed per second, AST nodes processed per millisecond.
* **Determinism Check:** Compare output artifact hashes across all runs to ensure 100% digest identity.

### Step 5: Comparative Analysis & Deterministic Classification Contract
Compare candidate metrics against baseline:
$$\Delta\% = \frac{\text{Candidate} - \text{Baseline}}{\text{Baseline}} \times 100$$

Every delta interval is deterministically classified with zero gaps and zero overlap:

#### A. Resource Consumption Metrics (Wall Time, CPU Time, Peak RSS, Allocations) — Lower is Better:
* **`REGRESSION`**: $\Delta\% > +3.0\%$ (resource consumption increased beyond experimental noise).
* **`NO MATERIAL CHANGE`**: $-3.0\% \le \Delta\% \le +3.0\%$ (metric variance is within experimental noise).
* **`IMPROVEMENT`**: $\Delta\% < -3.0\%$ (resource consumption decreased beyond experimental noise).

#### B. Throughput Metrics (Files Analyzed/s, AST Nodes Processed/ms) — Higher is Better:
* **`IMPROVEMENT`**: $\Delta\% > +3.0\%$ (throughput increased beyond experimental noise).
* **`NO MATERIAL CHANGE`**: $-3.0\% \le \Delta\% \le +3.0\%$ (throughput variance is within experimental noise).
* **`REGRESSION`**: $\Delta\% < -3.0\%$ (throughput degraded beyond experimental noise).

#### C. Whole-Run & Determinism Classifications:
* **`VERIFIED`**: Output digests match baseline 100% ($\Delta\% = 0.0\%$), and performance meets requirements without regression.
* **`INCONCLUSIVE`**: Inter-run variance exceeds $\pm 3.0\%$ or whole-repository memory scaling is not proven.

---

## 8. Memory Retention Audit ($O(\text{window})$ Invariant)
To verify that memory does not leak across analyzed files:
1. Analyze a corpus with $>10$ files.
2. Verify that prior AST results and nodes are garbage-collected as analysis moves to subsequent files:
   ```bash
   bun test tests/unit/orchestration/bounded-ast-retention.test.ts
   ```
3. Ensure no global array or Map accumulates AST references over the lifetime of the analysis run.

---

## 9. Expected Benchmark Report Schema
Every performance evaluation MUST terminate with this structured report:

```markdown
### PERFORMANCE & BENCHMARK AUDIT REPORT

* **Base Workspace / Revision:** <Exact base commit SHA / workspace path>
* **Candidate Workspace / Revision:** <Exact candidate commit SHA / workspace path>
* **Hardware / OS:** Windows / Linux / macOS (Architecture: x64/arm64)
* **Bun Version:** <live executable version; compare with the repository declaration>
* **Target Corpus:** Express / Fastify / Synthetic
* **Iterations:** N runs (1 warm-up discarded)

| Metric | Baseline | Candidate | Delta | Classification |
| :--- | :--- | :--- | :--- | :--- |
| **Wall Clock (Median)** | 120 ms | 115 ms | -4.17% | IMPROVEMENT |
| **Peak Memory (RSS)**   | 85 MB  | 86 MB  | +1.18% | NO MATERIAL CHANGE |
| **Throughput (files/s)**| 83 f/s | 87 f/s | +4.82% | IMPROVEMENT |
| **Determinism (SHA256)**| Matches| Matches| 0.00%  | VERIFIED |

* **Memory Status Disclosure:** VERIFIED | INCONCLUSIVE | REGRESSION | IMPROVEMENT | NO MATERIAL CHANGE
  *(Note: If whole-repo scaling was not established, include: "Memory/OOM neutrality was not established by this benchmark.")*
* **Overall Verdict:** PASS | REGRESSION DETECTED | INCONCLUSIVE
```

---

## 10. Prohibited Behavior
* Never claim "infinite scalability" or "zero memory overhead" without full corpus proof.
* Never cite a single run as evidence; always report repeated runs and variance.
* Never alter benchmark targets or corpus files to pass failing thresholds.
* Never create checkouts, switch refs, reset, or mutate base or candidate workspaces.
* Never evaluate performance without both isolated base and candidate workspaces prepared prior to measurement.
