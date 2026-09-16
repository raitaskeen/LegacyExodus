# Storage Service

> **Status:** `PARTIAL`. The current core implements injected in-memory and SQLite providers, a storage manager, run-scoped records, durable analysis commit, validated snapshot reuse, and contained `.discovery` projections. Enterprise databases, distributed artifact storage, retention services, multi-tenancy, and general checkpoint/resume are not implemented.

## Overview

Storage Service provides durable, versioned persistence for artifacts, metadata, and project execution state across the LegacyExodus pipeline.

## Scope

- artifacts
- project state
- metadata
- versioning
- persistence

## Purpose

- Persist all stage outputs and operational state reliably.
- Preserve provenance and auditability.
- Enable checkpoint/resume, replay, and compliance retrieval.

## Data Domains

### 1) Artifacts
- Discovery artifacts
- Parsed artifacts
- Graph snapshots
- Knowledge snapshots
- Transformation bundles
- Validation reports

### 2) Project State
- run lifecycle state
- stage progress state
- checkpoint pointers
- retry/terminal outcomes

### 3) Metadata
- provenance hashes
- policy/contract versions
- tenant and environment tags
- timestamps and lineage references

## Versioning Model

- Immutable artifact versions
- Append-only lineage links
- Explicit schema versions
- No silent overwrite of accepted records

## Persistence Architecture

```text
Pipeline Services
      |
      v
Storage API
      |
      +--> Artifact Store (binary/object)
      |
      +--> Metadata Store (relational/indexed)
      |
      +--> State Store (run/checkpoint lifecycle)
```

## Contracts

### Input
- Typed artifact/state write requests with provenance and policy context.

### Output
- Persisted record identifiers
- version/hash references
- retrieval pointers

## Consistency and Integrity

- Writes require integrity checksums.
- State transitions are transactionally guarded.
- Cross-reference integrity (artifact ↔ metadata ↔ state) must validate.

## Failure Handling

- Write failure => retry if transient; fail if integrity violation.
- Version conflict => reject and require explicit new version.
- Corrupt artifact => quarantine and block downstream consumption.

## Lifecycle & Resource Management

- **Persistent Storage (SQLite):** Calls `close()` during application shutdown to flush WAL logs, checkpoint open transactions, and release file handles.
- **In-Memory Storage:** Calls `clear()` during shutdown to free in-memory record maps and prevent memory leakage across consecutive runtime sessions.
- **Idempotent Disposal:** Repeated `shutdown()` calls are safe no-ops and never throw.

## Observability

- write/read latency
- storage growth by artifact class
- integrity failure rate
- checkpoint restore success rate
