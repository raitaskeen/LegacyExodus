# Knowledge Service (NolaraStruct Core)

## Overview

Knowledge Service is the intelligence heart of NolaraStruct. It synthesizes parsed and graph-derived signals into a governed system understanding model.

## Scope

- knowledge graph
- system intelligence model
- domain inference
- invariants
- context boundaries

## Purpose

- Build a durable, queryable representation of legacy system intent and structure.
- Provide contextual intelligence for architecture decisions and transformation planning.
- Preserve deterministic, auditable reasoning boundaries for AI-assisted workflows.

## Core Model Layers

### 1) Knowledge Graph
- Entities: modules, services, schemas, interfaces, data domains.
- Relationships: dependency, call, ownership, boundary, trust.

### 2) System Intelligence Model
- Derived interpretation layer:
  - architectural patterns
  - coupling hotspots
  - domain boundaries
  - modernization opportunities

### 3) Inference Layer
- Domain inference (bounded-context suggestions, capability clusters).
- Confidence-scored heuristics with provenance links.

## Context Boundaries

Knowledge Service enforces context boundaries so downstream AI and transformation components receive scoped, policy-approved slices—not full raw dumps.

## Invariants (Normative)

1. Every inferred claim must trace to source evidence.
2. Confidence must be explicit for inferred, non-deterministic conclusions.
3. Policy-scoped context boundaries must be enforced at query/export time.
4. Knowledge snapshots are immutable and versioned.
5. No silent mutation of prior accepted knowledge states.

## Processing Flow

```text
Parsed Artifacts + Graph Snapshots
            |
            v
Knowledge Normalization
            |
            v
Inference + Rule Evaluation
            |
            v
Knowledge Snapshot (Versioned)
            |
            v
Context Export API
```

## Contracts

### Input
- Parsed artifacts
- Graph snapshots
- inference/policy configuration

### Output
- `KnowledgeSnapshot`
- `ContextSlice` (policy-filtered)
- inference evidence reports

## Failure Handling

- Evidence gaps => mark inference unresolved (not fabricated).
- Schema mismatch => reject ingest.
- Policy boundary violation => deny context export.

## Observability

- Snapshot build duration
- Inference coverage/confidence
- Context export deny/allow rates
- Invariant violation counts
