# LegacyExodus — Phase 3A Real-Repository Benchmark Report

> **Generated**: 2026-08-23T09:54:41.648Z
> **Engine Commit**: `local` (0.1.0)
> **Environment**: win32-x64-bun-v24.3.0
> **Schema Version**: v1

## 1. Benchmark Health & Governance Summary

| Repository | Tier | Role | Correctness | Completeness | Determinism | Performance | Quality Sample | Overall Health |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **LegacyExodus** | `tier-1` | EXTERNAL | `PASS` | `PASS` | `PASS` | `STABLE` | `PASS` | **`PASS`** |
| **cookie-parser** | `tier-1` | EXTERNAL | `PASS` | `PASS` | `PASS` | `STABLE` | `PASS` | **`PASS`** |
| **debug** | `tier-1` | EXTERNAL | `PASS` | `PASS` | `PASS` | `STABLE` | `PASS` | **`PASS`** |
| **express** | `tier-3` | EXTERNAL | `PASS` | `NEEDS_REVIEW` | `PASS` | `STABLE` | `PASS` | **`NEEDS_REVIEW`** |
| **express-session** | `tier-1` | EXTERNAL | `PASS` | `PASS` | `PASS` | `STABLE` | `PASS` | **`PASS`** |
| **fastify** | `tier-2` | EXTERNAL | `PASS` | `PASS` | `PASS` | `STABLE` | `PASS` | **`PASS`** |
| **legacy-exodus-core** | `self-analysis` | SELF-ANALYSIS | `PASS` | `PASS` | `PASS` | `STABLE` | `PASS` | **`PASS`** |
| **ms** | `tier-1` | EXTERNAL | `PASS` | `PASS` | `PASS` | `STABLE` | `PASS` | **`PASS`** |

## 2. Discovery Funnel & Mathematical Accounting

> **Invariant Verification**: `filesDiscovered = analyzed + parserFailures + symbolFailures + unsupported + nonSource + unclassified`

| Repository | Discovered | Analyzed | Parser Fail | Symbol Fail | Unsupported | Non-Source | Unclassified | Accounting Invariant |
|---|---:|---:|---:|---:|---:|---:|---:|:---:|
| **LegacyExodus** | 383 | 138 | 0 | 0 | 0 | 212 | 33 | ✓ PASS (0 discrepancy) |
| **cookie-parser** | 12 | 2 | 0 | 0 | 0 | 10 | 0 | ✓ PASS (0 discrepancy) |
| **debug** | 13 | 7 | 0 | 0 | 0 | 6 | 0 | ✓ PASS (0 discrepancy) |
| **express** | 234 | 152 | 0 | 0 | 0 | 48 | 34 | ✓ PASS (0 discrepancy) |
| **express-session** | 25 | 13 | 0 | 0 | 0 | 12 | 0 | ✓ PASS (0 discrepancy) |
| **fastify** | 385 | 287 | 0 | 0 | 1 | 97 | 0 | ✓ PASS (0 discrepancy) |
| **legacy-exodus-core** | 111 | 95 | 0 | 0 | 0 | 16 | 0 | ✓ PASS (0 discrepancy) |
| **ms** | 9 | 2 | 0 | 0 | 0 | 7 | 0 | ✓ PASS (0 discrepancy) |

## 3. Semantic Analysis

| Repository | Total Calls | Resolved Calls | Unresolved Calls | Total Symbols | Functions | Classes | Imports | Exports | Dep Edges | Cycles | Entry Points | Dead Code |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **LegacyExodus** | 4280 | 938 | 3342 | 2964 | 227 | 50 | 736 | 228 | 58 | 0 | 14 | 1205 |
| **cookie-parser** | 186 | 15 | 171 | 53 | 6 | 0 | 7 | 5 | 0 | 0 | 1 | 36 |
| **debug** | 181 | 19 | 162 | 128 | 23 | 0 | 9 | 24 | 2 | 0 | 1 | 91 |
| **express** | 8984 | 342 | 8642 | 2817 | 3415 | 0 | 414 | 91 | 46 | 0 | 22 | 1832 |
| **express-session** | 1497 | 370 | 1127 | 521 | 70 | 0 | 43 | 13 | 11 | 0 | 1 | 425 |
| **fastify** | 29254 | 1062 | 28192 | 7596 | 608 | 9 | 1729 | 163 | 174 | 0 | 133 | 5554 |
| **legacy-exodus-core** | 1956 | 532 | 1424 | 1733 | 179 | 49 | 394 | 228 | 55 | 0 | 14 | 366 |
| **ms** | 250 | 7 | 243 | 18 | 4 | 0 | 0 | 1 | 0 | 0 | 1 | 13 |

## 4. Flow Analysis (CFG & DFG)

| Repository | CFG Count | Basic Blocks | CFG Edges | Dominators | DFG Count | Definitions | Uses | Def-Use Chains | Taint Flows | Interprocedural | KG Nodes | KG Edges |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **LegacyExodus** | 1409 | - | - | - | 138 | 3309 | 12033 | 3309 | 0 | 1704 | 3102 | 3022 |
| **cookie-parser** | 61 | 183 | 140 | 183 | 2 | 109 | 160 | 109 | 0 | 26 | 55 | 53 |
| **debug** | 80 | 316 | 280 | 316 | 7 | 231 | 312 | 231 | 0 | 17 | 135 | 130 |
| **express** | 3415 | 9210 | 7114 | 9210 | 152 | 6863 | 5545 | 6863 | 8 | 388 | 2969 | 2863 |
| **express-session** | 582 | 2034 | 1697 | 2034 | 13 | 1439 | 1774 | 1439 | 0 | 398 | 534 | 532 |
| **fastify** | 8812 | 23473 | 16152 | 23473 | 287 | 20372 | 41636 | 20372 | 0 | 1069 | 7883 | 7770 |
| **legacy-exodus-core** | 715 | 3095 | 2935 | 3095 | 95 | 2137 | 8275 | 2137 | 0 | 1257 | 1828 | 1788 |
| **ms** | 73 | 242 | 245 | 242 | 2 | 50 | 87 | 50 | 0 | 33 | 20 | 18 |

## 5. Performance & Resource Footprint

| Repository | Avg Duration | Min Duration | Max Duration | Files / Sec | Analyzed / Sec | ms / CFG | ms / DFG | Peak RSS |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **LegacyExodus** | 6286.3 ms | 4096.3 ms | 10019.0 ms | 0.0 | 0.0 | 0.00 ms | 0.00 ms | N/A |
| **cookie-parser** | 118.6 ms | 73.3 ms | 187.8 ms | 101.2 | 16.9 | 1.94 ms | 59.30 ms | 199 MB |
| **debug** | 298.7 ms | 121.5 ms | 649.7 ms | 43.5 | 23.4 | 3.73 ms | 42.68 ms | 202.5 MB |
| **express** | 4200.0 ms | 3970.0 ms | 4644.0 ms | 55.7 | 36.2 | 1.23 ms | 27.63 ms | 586 MB |
| **express-session** | 739.8 ms | 680.4 ms | 831.5 ms | 33.8 | 17.6 | 1.27 ms | 56.91 ms | 350.6 MB |
| **fastify** | 28084.0 ms | 25923.9 ms | 29339.3 ms | 13.7 | 10.2 | 3.19 ms | 97.85 ms | 1074 MB |
| **legacy-exodus-core** | 4152.1 ms | 2265.8 ms | 5101.1 ms | 26.7 | 22.9 | 5.81 ms | 43.71 ms | 422.6 MB |
| **ms** | 140.1 ms | 84.1 ms | 230.5 ms | 64.2 | 14.3 | 1.92 ms | 70.06 ms | 199 MB |

## 6. Multi-Run Determinism Gate

| Repository | Total Runs | Deterministic Status | Artifacts Evaluated | Semantic Invariance |
|---|---:|:---:|---:|:---:|
| **LegacyExodus** | 3 | ✓ PASS (100% byte-identical) | 13 | ✓ 0 differences |
| **cookie-parser** | 3 | ✓ PASS (100% byte-identical) | 12 | ✓ 0 differences |
| **debug** | 3 | ✓ PASS (100% byte-identical) | 12 | ✓ 0 differences |
| **express** | 3 | ✓ PASS (100% byte-identical) | 12 | ✓ 0 differences |
| **express-session** | 3 | ✓ PASS (100% byte-identical) | 12 | ✓ 0 differences |
| **fastify** | 3 | ✓ PASS (100% byte-identical) | 12 | ✓ 0 differences |
| **legacy-exodus-core** | 3 | ✓ PASS (100% byte-identical) | 12 | ✓ 0 differences |
| **ms** | 3 | ✓ PASS (100% byte-identical) | 12 | ✓ 0 differences |

## 7. Deterministic Quality Sampling Summary

| Repository | Sample Seed | Derivation Hash | Population (Resolved Calls) | Sample Size | Review Disposition |
|---|---:|:---:|---:|---:|:---:|
| **cookie-parser** | 42 | `55bd865d7b` | 15 | 20 | Sample Verified Correct |
| **debug** | 42 | `8f83543e61` | 19 | 20 | Sample Verified Correct |
| **express** | 42 | `c829e1104a` | 342 | 20 | Sample Verified Correct |
| **express-session** | 42 | `a6135a7ffa` | 370 | 20 | Sample Verified Correct |
| **fastify** | 42 | `9a0c207149` | 1062 | 20 | Sample Verified Correct |
| **legacy-exodus-core** | 42 | `8819b287d4` | 532 | 20 | Sample Verified Correct |
| **ms** | 42 | `ce177f231b` | 7 | 20 | Sample Verified Correct |

## 8. Multi-File Migration Fidelity Validation Summary (Track 3 / P1.7B)

> **Validation Framework**: Three-Universe Evaluation Model (Ground Truth Facts, Scoped Predictions, Unvalidated Predictions).
> **Safety Verdict Policy**: Absolute safety requires exhaustive whole-repository ground truth; sample-based validation strictly reports `MIGRATION_SAFETY_NOT_YET_ESTABLISHED`.

| Target Repository | Validated Files | GT Facts | Scoped Preds | Unvalidated Preds | True Positives | Unverified Scoped | False Negatives | Sample Recall | Actionable Correctness | Known-Negative Violations | Migration Safety Verdict |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Express v4.21.2** (Tier-3) | 25 | 142 (+5 KN) | 4,165 | 12,599 | 142 | 4,023 | 0 | **100.0%** | **100.0%** | 0 | `MIGRATION_SAFETY_NOT_YET_ESTABLISHED` |
| **Fastify v5.3.3** (Tier-2) | 25 | 154 (+5 KN) | 6,330 | 45,262 | 154 | 6,176 | 0 | **100.0%** | **100.0%** | 0 | `MIGRATION_SAFETY_NOT_YET_ESTABLISHED` |

### Express v4.21.2 Category Breakdown (25 Validated Files)
| Category | Scope Model | GT Count | Scoped Preds | Unvalidated Preds | TP | Unverified Scoped | False Negatives | Precision | Recall |
|---|---|---:|---:|---:|---:|---:|---:|:---:|---:|
| **file** | SAMPLE | 25 | 25 | 209 | 25 | 0 | 0 | 100.0% | 100.0% |
| **dependency** | CLOSED | 16 | 47 | 0 | 16 | 31 (FP) | 0 | 34.0% | 100.0% |
| **framework** | CLOSED | 1 | 1 | 0 | 1 | 0 | 0 | 100.0% | 100.0% |
| **symbol** | SAMPLE | 27 | 1,131 | 2,036 | 27 | 1,104 | 0 | N/A (Sample) | 100.0% |
| **import** | SAMPLE | 17 | 111 | 306 | 17 | 94 | 0 | N/A (Sample) | 100.0% |
| **export** | SAMPLE | 16 | 39 | 52 | 16 | 23 | 0 | N/A (Sample) | 100.0% |
| **dependency_edge** | SAMPLE | 14 | 24 | 24 | 14 | 10 | 0 | N/A (Sample) | 100.0% |
| **call** | SAMPLE | 15 | 2,057 | 7,135 | 15 | 2,042 | 0 | N/A (Sample) | 100.0% |
| **cfg** | SAMPLE | 6 | 706 | 2,709 | 6 | 700 | 0 | N/A (Sample) | 100.0% |
| **dfg** | SAMPLE | 5 | 24 | 128 | 5 | 19 | 0 | N/A (Sample) | 100.0% |

### Fastify v5.3.3 Category Breakdown (25 Validated Files)
| Category | Scope Model | GT Count | Scoped Preds | Unvalidated Preds | TP | Unverified Scoped | False Negatives | Precision | Recall |
|---|---|---:|---:|---:|---:|---:|---:|:---:|---:|
| **file** | SAMPLE | 25 | 25 | 360 | 25 | 0 | 0 | 100.0% | 100.0% |
| **dependency** | CLOSED | 14 | 53 | 0 | 14 | 39 (FP) | 0 | 26.4% | 100.0% |
| **symbol** | SAMPLE | 32 | 2,116 | 7,393 | 32 | 2,084 | 0 | N/A (Sample) | 100.0% |
| **import** | SAMPLE | 17 | 317 | 1,413 | 17 | 300 | 0 | N/A (Sample) | 100.0% |
| **export** | SAMPLE | 18 | 225 | 138 | 18 | 207 | 0 | N/A (Sample) | 100.0% |
| **dependency_edge** | SAMPLE | 20 | 283 | 212 | 20 | 263 | 0 | N/A (Sample) | 100.0% |
| **call** | SAMPLE | 16 | 2,509 | 27,449 | 16 | 2,493 | 0 | N/A (Sample) | 100.0% |
| **cfg** | SAMPLE | 7 | 777 | 8,035 | 7 | 770 | 0 | N/A (Sample) | 100.0% |
| **dfg** | SAMPLE | 5 | 25 | 262 | 5 | 20 | 0 | N/A (Sample) | 100.0% |
