# Graph Service

> **Status:** `PARTIAL`. Deterministic dependency, knowledge, semantic call/reference, CFG, DFG, and conservative taint artifacts are implemented for supported static JS/TS evidence. A long-running graph service, general query API, percentile telemetry, complete runtime behavior, vulnerability detection, and transformation planning are not implemented.

## Overview

The current graph layer builds deterministic structural relationship artifacts from parsed evidence. It does not expose a general graph server or claim transformation-planning semantics.

## Current scope

- dependency graph
- call graph
- control flow graph
- data flow graph
- deterministic validated graph artifacts and projections

## Purpose

- Convert parsed code into navigable system relationships.
- Provide graph-backed structural evidence for current semantic and flow analysis.
- Provide deterministic artifacts for inspection and future decision support.

## Graph Types

### 1) Dependency Graph
- Repository-local file/symbol relationships proven from supported ESM/CommonJS imports and exports.
- Relative-path and proven `tsconfig` alias resolution, named/default/wildcard re-export traversal, and deterministic cycle reporting.
- Full Node/package/workspace resolution and confidence-scored inferred dependencies are not implemented.

### 2) Call Graph
- Conservative function/method invocation relationships with exact target IDs when static evidence proves a unique target.
- Supported imported and namespace calls can cross file boundaries; ambiguous or dynamic targets remain unresolved or unrecorded according to the semantic contract.

### 3) Control Flow Graph (CFG)
- Execution path structure within routines/components.
- Branching, loops, and termination paths.

### 4) Data Flow Graph (DFG)
- Data lineage and transformation pathways.
- Variable/field propagation and sink/source mapping.

## Processing Pipeline

```text
Parsed Artifact
      |
      v
Graph Extractors
      |
      v
Graph Normalization
      |
      v
StorageManager + projections
      |
      v
Validated JSON artifacts
```

## Target query capabilities

The following are `TARGET ARCHITECTURE`; the current CLI does not expose a general graph-query service:

- Impact analysis (`what depends on X?`)
- Reachability (`can A reach B?`)
- Hotspot detection (high fan-in/fan-out nodes)
- Unsafe path identification (sensitive data flows)

## Current contracts

### Input
- Parsed artifacts + extraction rules.

### Output
- Immutable, Zod-validated dependency, knowledge, semantic, control-flow, and data-flow contracts persisted as run-scoped records and projected artifacts.

## Consistency Rules

- Graph nodes and edges use deterministic identities and canonical ordering where defined by their contracts.
- Invalid graph payloads are rejected at validation boundaries.
- Unknown or ambiguous relationships are not fabricated.

## Failure Handling

- Per-file parser and symbol failures remain isolated and reported; downstream artifacts reflect only successfully analyzed evidence.
- Invalid node/edge schemas are rejected.

## Target architecture

A long-running graph service, general query API, graph-version migration, confidence/provenance enrichment for every edge, percentile telemetry, vulnerability detection, and transformation-planning queries remain target architecture.

## Target observability

- Graph build time by graph type
- Node/edge counts
- Query latency percentiles
- Extraction confidence distribution
