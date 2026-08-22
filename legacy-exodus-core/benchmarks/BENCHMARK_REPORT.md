# LegacyExodus — Phase 3A Real-Repository Benchmark Report

> **Generated**: 2026-08-22T07:30:29.034Z
> **Engine Commit**: `local` (0.1.0)
> **Environment**: win32-x64-bun-v24.3.0
> **Schema Version**: v1

## 1. Benchmark Health & Governance Summary

| Repository | Tier | Role | Correctness | Completeness | Determinism | Performance | Quality Sample | Overall Health |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **LegacyExodus** | `tier-1` | EXTERNAL | `PASS` | `PASS` | `PASS` | `STABLE` | `PASS` | **`PASS`** |
| **cookie-parser** | `tier-1` | EXTERNAL | `PASS` | ⚠️ `NEEDS_REVIEW` | `PASS` | `STABLE` | `PASS` | **⚠️ `NEEDS_REVIEW`** |
| **debug** | `tier-1` | EXTERNAL | `PASS` | `PASS` | `PASS` | `STABLE` | `PASS` | **`PASS`** |
| **express-session** | `tier-1` | EXTERNAL | `PASS` | ⚠️ `NEEDS_REVIEW` | `PASS` | `STABLE` | `PASS` | **⚠️ `NEEDS_REVIEW`** |
| **fastify** | `tier-2` | EXTERNAL | `PASS` | ⚠️ `NEEDS_REVIEW` | `PASS` | `STABLE` | `PASS` | **⚠️ `NEEDS_REVIEW`** |
| **legacy-exodus-core** | `self-analysis` | SELF-ANALYSIS | `PASS` | ⚠️ `NEEDS_REVIEW` | `PASS` | `STABLE` | `PASS` | **⚠️ `NEEDS_REVIEW`** |
| **ms** | `tier-1` | EXTERNAL | `PASS` | `PASS` | `PASS` | `STABLE` | `PASS` | **`PASS`** |

## 2. Discovery Funnel & Mathematical Accounting

> **Invariant Verification**: `filesDiscovered = analyzed + parserFailures + symbolFailures + unsupported + nonSource + unclassified`

| Repository | Discovered | Analyzed | Parser Fail | Symbol Fail | Unsupported | Non-Source | Unclassified | Accounting Invariant |
|---|---:|---:|---:|---:|---:|---:|---:|:---:|
| **LegacyExodus** | 383 | 138 | 0 | 0 | 0 | 212 | 33 | ✓ PASS (0 discrepancy) |
| **cookie-parser** | 12 | 2 | 0 | 0 | 0 | 8 | 2 | ✓ PASS (0 discrepancy) |
| **debug** | 13 | 7 | 0 | 0 | 0 | 4 | 2 | ✓ PASS (0 discrepancy) |
| **express-session** | 25 | 13 | 0 | 0 | 0 | 7 | 5 | ✓ PASS (0 discrepancy) |
| **fastify** | 385 | 287 | 0 | 0 | 1 | 86 | 11 | ✓ PASS (0 discrepancy) |
| **legacy-exodus-core** | 111 | 95 | 0 | 0 | 0 | 0 | 16 | ✓ PASS (0 discrepancy) |
| **ms** | 9 | 2 | 0 | 0 | 0 | 6 | 1 | ✓ PASS (0 discrepancy) |

## 3. Semantic Analysis

| Repository | Total Calls | Resolved Calls | Unresolved Calls | Total Symbols | Functions | Classes | Imports | Exports | Dep Edges | Cycles | Entry Points | Dead Code |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **LegacyExodus** | 4280 | 938 | 3342 | 2964 | 227 | 50 | 736 | 228 | 58 | 0 | 14 | 1205 |
| **cookie-parser** | 186 | 15 | 171 | 53 | 6 | 0 | 7 | 5 | 0 | 0 | 1 | 36 |
| **debug** | 181 | 19 | 162 | 128 | 23 | 0 | 9 | 24 | 2 | 0 | 1 | 91 |
| **express-session** | 1497 | 370 | 1127 | 521 | 70 | 0 | 43 | 13 | 11 | 0 | 1 | 425 |
| **fastify** | 29254 | 1062 | 28192 | 7596 | 608 | 9 | 1729 | 163 | 174 | 0 | 133 | 5554 |
| **legacy-exodus-core** | 1932 | 529 | 1403 | 1706 | 178 | 49 | 391 | 226 | 56 | 0 | 14 | 359 |
| **ms** | 250 | 7 | 243 | 18 | 4 | 0 | 0 | 1 | 0 | 0 | 1 | 13 |

## 4. Flow Analysis (CFG & DFG)

| Repository | CFG Count | Basic Blocks | CFG Edges | Dominators | DFG Count | Definitions | Uses | Def-Use Chains | Taint Flows | Interprocedural | KG Nodes | KG Edges |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **LegacyExodus** | 1409 | - | - | - | 138 | 3309 | 12033 | 3309 | 0 | 1704 | 3102 | 3022 |
| **cookie-parser** | 61 | 183 | 140 | 183 | 2 | 109 | 160 | 109 | 0 | 26 | 55 | 53 |
| **debug** | 80 | - | - | - | 7 | 231 | 312 | 231 | 0 | 17 | 135 | 130 |
| **express-session** | 582 | 2034 | 1697 | 2034 | 13 | 1439 | 1774 | 1439 | 0 | 398 | 534 | 532 |
| **fastify** | 8812 | 23473 | 16152 | 23473 | 287 | 20372 | 41636 | 20372 | 0 | 1069 | 7883 | 7770 |
| **legacy-exodus-core** | 739 | 3095 | 2897 | 3095 | 95 | 2127 | 8068 | 2127 | 0 | 1233 | 1801 | 1762 |
| **ms** | 73 | - | - | - | 2 | 50 | 87 | 50 | 0 | 33 | 20 | 18 |

## 5. Performance & Resource Footprint

| Repository | Avg Duration | Min Duration | Max Duration | Files / Sec | Analyzed / Sec | ms / CFG | ms / DFG | Peak RSS |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **LegacyExodus** | 6286.3 ms | 4096.3 ms | 10019.0 ms | 0.0 | 0.0 | 0.00 ms | 0.00 ms | N/A |
| **cookie-parser** | 114.4 ms | 86.9 ms | 162.8 ms | 104.9 | 17.5 | 1.88 ms | 57.20 ms | 208.6 MB |
| **debug** | 311.4 ms | 165.8 ms | 602.4 ms | 0.0 | 0.0 | 0.00 ms | 0.00 ms | N/A |
| **express-session** | 718.7 ms | 628.6 ms | 822.4 ms | 34.8 | 18.1 | 1.23 ms | 55.29 ms | 339.9 MB |
| **fastify** | 11996.0 ms | 10970.7 ms | 12646.3 ms | 32.1 | 23.9 | 1.36 ms | 41.80 ms | 2347.5 MB |
| **legacy-exodus-core** | 1611.9 ms | 1460.1 ms | 1874.5 ms | 68.9 | 58.9 | 2.18 ms | 16.97 ms | 466.4 MB |
| **ms** | 388.7 ms | 283.4 ms | 599.3 ms | 0.0 | 0.0 | 0.00 ms | 0.00 ms | N/A |

## 6. Multi-Run Determinism Gate

| Repository | Total Runs | Deterministic Status | Artifacts Evaluated | Semantic Invariance |
|---|---:|:---:|---:|:---:|
| **LegacyExodus** | 3 | ✓ PASS (100% byte-identical) | 13 | ✓ 0 differences |
| **cookie-parser** | 3 | ✓ PASS (100% byte-identical) | 13 | ✓ 0 differences |
| **debug** | 3 | ✓ PASS (100% byte-identical) | 13 | ✓ 0 differences |
| **express-session** | 3 | ✓ PASS (100% byte-identical) | 13 | ✓ 0 differences |
| **fastify** | 3 | ✓ PASS (100% byte-identical) | 13 | ✓ 0 differences |
| **legacy-exodus-core** | 3 | ✓ PASS (100% byte-identical) | 13 | ✓ 0 differences |
| **ms** | 3 | ✓ PASS (100% byte-identical) | 13 | ✓ 0 differences |

## 7. Deterministic Quality Sampling Summary

| Repository | Sample Seed | Derivation Hash | Population (Resolved Calls) | Sample Size | Review Disposition |
|---|---:|:---:|---:|---:|:---:|
| **cookie-parser** | 42 | `cf04eb7cc6` | 15 | 20 | Sample Verified Correct |
| **express-session** | 42 | `51a3e8ef67` | 370 | 20 | Sample Verified Correct |
| **fastify** | 42 | `f6c1701f1c` | 1062 | 20 | Sample Verified Correct |
| **legacy-exodus-core** | 42 | `ad994afaaf` | 529 | 20 | Sample Verified Correct |
