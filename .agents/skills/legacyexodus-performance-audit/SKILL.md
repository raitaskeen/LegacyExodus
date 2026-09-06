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

## 5. Critical Memory Disclosure Rule
> **"A tiny instantaneous RSS reading does NOT constitute proof of OOM safety. Memory safety is established ONLY by demonstrating bounded working set scaling under heavy workloads."**

Agents MUST explicitly classify memory and performance measurements into one of five states:
1. **`VERIFIED`**: Proven by heap snapshots, GC pressure tests, determinism checks, and stress tests on large corpus.
2. **`INCONCLUSIVE`**: Measurements exhibit variance $> \pm 3.0\%$ across repetitions, environmental interference occurred, or long-term/whole-repository scaling was not established.
3. **`REGRESSION`**: Resource consumption exceeded baseline by more than experimental noise ($\Delta\% > +3.0\%$) or throughput degraded ($\Delta\% < -3.0\%$).
4. **`IMPROVEMENT`**: Reproducible reduction in resource consumption ($\Delta\% < -3.0\%$) or increase in throughput ($\Delta\% > +3.0\%$) under identical conditions.
5. **`NO MATERIAL CHANGE`**: Variance is within normal experimental noise ($-3.0\% \le \Delta\% \le +3.0\%$).

---

## 6. Operating Procedure

### Step 1: Baseline Establishment
* Check out the unchanged base commit.
* Run the benchmark suite to capture the baseline performance:
  ```bash
  bun run benchmark audit
  bun run benchmark run express --runs 3
  ```
* Record median wall time, peak memory, and CPU utilization.

### Step 2: Controlled Environment Preparation
* Close background processes to minimize CPU throttling and memory contention.
* Record hardware, OS, Bun version, and CPU architecture.

### Step 3: Warm-Up & Execution
* Discard the first cold-start iteration to account for JIT warm-up and filesystem cache priming.
* Execute at least three consecutive measurement runs:
  ```bash
  bun run benchmark run <target> --runs 3
  ```

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

## 7. Memory Retention Audit ($O(\text{window})$ Invariant)
To verify that memory does not leak across analyzed files:
1. Analyze a corpus with $>10$ files.
2. Verify that prior AST results and nodes are garbage-collected as analysis moves to subsequent files:
   ```bash
   bun test tests/unit/orchestration/bounded-ast-retention.test.ts
   ```
3. Ensure no global array or Map accumulates AST references over the lifetime of the analysis run.

---

## 8. Expected Benchmark Report Schema
Every performance evaluation MUST terminate with this structured report:

```markdown
### PERFORMANCE & BENCHMARK AUDIT REPORT

* **Hardware / OS:** Windows / Linux / macOS (Architecture: x64/arm64)
* **Bun Version:** 1.3.x
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

## 9. Prohibited Behavior
* Never claim "infinite scalability" or "zero memory overhead" without full corpus proof.
* Never cite a single run as evidence; always report repeated runs and variance.
* Never alter benchmark targets or corpus files to pass failing thresholds.
