# Graph Service

> **Status:** `PARTIAL`. Deterministic dependency, knowledge, semantic call/reference, CFG, DFG, and conservative taint artifacts are implemented for supported static JS/TS evidence. A long-running graph service, general query API, percentile telemetry, complete runtime behavior, vulnerability detection, and transformation planning are not implemented.

## Overview

Graph Service builds and serves structural relationship graphs derived from parsed artifacts to support architecture inference, transformation planning, and validation reasoning.

## Scope

- dependency graph
- call graph
- control flow graph
- data flow graph
- deterministic projected graph artifacts

## Purpose

- Convert parsed code into navigable system relationships.
- Provide graph-backed intelligence for NolaraStruct and downstream stages.
- Provide deterministic artifacts for analysis and future decision support.

## Graph Types

### 1) Dependency Graph
- Module/package/service dependencies.
- Declared and inferred edges with confidence.

### 2) Call Graph
- Function/method invocation relationships.
- Cross-file and cross-module calls.

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

## Contracts

### Input
- Parsed artifacts + extraction rules.

### Output
- Versioned graph snapshots + query indexes.

## Consistency Rules

- Graph edges must retain provenance.
- Edge/node schema versions must match graph version.
- Conflicts are resolved by deterministic merge strategy.

## Failure Handling

- Partial graph build allowed only with explicit completeness metrics.
- Invalid node/edge schemas rejected.
- Query execution failures return structured diagnostics.

## Observability

- Graph build time by graph type
- Node/edge counts
- Query latency percentiles
- Extraction confidence distribution
