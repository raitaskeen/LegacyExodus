# Knowledge Service (NolaraStruct Core)

> **Status:** `PARTIAL`. The current core builds deterministic knowledge and semantic artifacts from files, symbols, imports/exports, and supported calls/references. Domain inference, business-intent recovery, architectural recommendations, confidence aggregation, and AI-assisted reasoning are not implemented.

## Overview

The current knowledge layer converts parsed and graph-derived signals into deterministic structural evidence. It does not infer business intent or enforce a policy-scoped context service.

## Current scope

- deterministic knowledge graph derived from discovered files, symbols, imports, exports, and dependency edges
- semantic calls, references, supported Express route/middleware facts, entry-point facts, and conservative unused/dead-code indicators
- immutable validated storage/projection contracts

## Current purpose

- Build deterministic structural evidence for supported JavaScript/TypeScript inputs.
- Preserve unresolved relationships rather than fabricating runtime meaning.
- Supply validated static-analysis artifacts for inspection and future downstream systems.

## Current model layers

### 1) Knowledge Graph
- Nodes represent files and extracted symbols.
- Edges represent containment, exports, and resolved imports from the current graph builder.

### 2) Semantic Analysis
- Conservative calls and references with explicit resolution state.
- Supported Express routes/middleware, entry points, and static unused/dead-code indicators.

### 3) Flow Analysis
- CFG/DFG artifacts and deterministic built-in taint propagation for supported patterns.

## Current invariants

1. Validated static evidence is deterministic for the same supported input and configuration.
2. Unknown, ambiguous, and unsupported relationships are not promoted to resolved facts.
3. Analysis artifacts are immutable after contract construction.
4. Static evidence is not runtime behavior, business intent, vulnerability absence, or migration-safety proof.

## Processing Flow

```text
Files + Symbols + Dependency Graph
            |
            v
Knowledge Graph + Semantic Analysis
            |
            v
CFG / DFG / Conservative Taint
            |
            v
Run-scoped Storage + Projections
```

## Contracts

### Input
- discovered file paths
- symbol tables
- dependency graph
- normalized AST evidence for semantic and flow analysis

### Output
- validated `KnowledgeGraph` and `SemanticAnalysis` artifacts
- validated control-flow and data-flow artifacts

## Failure Handling

- Evidence gaps remain unresolved rather than fabricated.
- Schema mismatches reject the affected contract/persisted snapshot.
- Parser and symbol failures are isolated and surfaced as analysis diagnostics.

## Target architecture

Domain/business-intent inference, architectural recommendations, confidence aggregation, policy-scoped context export, AI-assisted reasoning, and a general query service are not implemented. The current built-in taint policy is not project-configurable or plugin-extensible.

## Target observability

- Snapshot build duration
- Inference coverage/confidence
- Context export deny/allow rates
- Invariant violation counts
