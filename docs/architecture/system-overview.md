# LegacyExodus System Overview

**Current-status evidence:** [`CURRENT_IMPLEMENTATION.md`](../CURRENT_IMPLEMENTATION.md)

LegacyExodus currently provides deterministic local repository intelligence for supported JavaScript/TypeScript code. It does not yet perform migration or generated-system validation.

## Current architecture

```text
CLI / programmatic caller
  -> LegacyExodusEngine
     -> ApplicationRuntime
     -> Orchestrator + command handlers
     -> Event bus/store + durable journal
     -> Discovery
     -> Parser registry/manager + Babel adapter
     -> Symbols + module/dependency graph
     -> Knowledge + semantic analysis
     -> CFG / DFG / conservative taint
     -> StorageManager
        -> MemoryStorageProvider or SqliteStorageProvider
        -> DiscoveryProjectionService
           -> contained .discovery artifacts + manifest
```

### Ownership boundaries

- The CLI translates user intent and formats results; it does not implement analysis.
- The engine owns lifecycle and exposes the application boundary.
- The orchestrator sequences deterministic analysis and records domain events.
- Analysis subsystems produce immutable, schema-validated models.
- Storage providers own persistence; projections own derived files.
- Repository source is observed, not rewritten.

## Current pipeline states

| Area | State | Boundary |
|---|---|---|
| VyrixScout discovery | `VERIFIED` | Inventory, classification, package/framework signals, failures |
| Parser/symbol/module analysis | `VERIFIED` | Supported JS/TS syntax and repository-local resolution |
| Knowledge/semantic/flow analysis | `PARTIAL` | Deterministic static facts; dynamic/runtime semantics remain conservative |
| Local storage and projection | `VERIFIED` | Memory/SQLite, run isolation, validated reuse, contained publication |
| Plugin foundation | `IMPLEMENTED` | Contracts/registry/loader; no sandboxed package ecosystem |
| Transformation/generation | `NOT IMPLEMENTED` | Target architecture |
| Generated-system governance | `NOT IMPLEMENTED` | Target architecture; benchmark governance is narrower |

## Trust boundaries

1. **Repository input:** paths and contents are untrusted. Discovery constrains traversal and records failures.
2. **Parser/analysis:** malformed or unsupported inputs are isolated and represented explicitly.
3. **Persistence:** run-scoped payloads are validated; reused snapshots require integrity and schema checks.
4. **Projection:** LegacyExodus-owned `.discovery` and `.legacy-exodus` writes are contained and published atomically.
5. **Claims:** static evidence is not promoted to runtime behavior, vulnerability absence, or migration safety.

## Determinism

Stable ordering and content-based identities are part of current contracts. Generated timestamps and random values must not enter canonical analysis output. Determinism claims apply to supported inputs and verified execution paths, not to future distributed or AI systems.

## Target architecture

The intended product adds two later stages after current deterministic understanding:

- **ZelvoxForge:** migration planning and transformation.
- **VymosGate:** isolated compilation, behavioral validation, governance, and approval.

IR/SSA, AI integration, target-language generation, enterprise deployment, and automated repair are planned/target concepts. They are not current components.
