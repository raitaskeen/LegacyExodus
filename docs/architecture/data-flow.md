# Data Flow

## Current executable analysis flow

```text
AnalyzeProject command
  -> engine lifecycle boundary
  -> orchestrator
  -> repository discovery
  -> per-file parse and normalized AST
  -> symbol extraction
  -> module/dependency resolution
  -> knowledge and semantic analysis
  -> CFG / DFG / conservative taint facts
  -> atomic run-scoped storage
  -> validated .discovery projection
  -> CLI analysis summary
```

### Failure behavior

- Enumeration, parser, and symbol-extraction failures are categorized rather than silently disappearing.
- Supported files continue where per-file isolation permits.
- A terminal analysis failure is represented in events/state and rejected by the engine boundary.
- Snapshot reuse requires workspace freshness, manifest integrity, and canonical schema validation; otherwise the engine recomputes.

### Storage and projection

Domain analysis does not write files directly. Records flow through `StorageManager` to the active memory or SQLite provider. `DiscoveryProjectionService` queries a single completed run and delegates contained atomic `.discovery` publication to its file adapter.

The event journal is append-only durable execution evidence. JSON projection artifacts are derived views and are not the event store.

## Target modernization flow

```text
verified static knowledge
  -> language-independent IR/SSA
  -> migration plan
  -> controlled transformation
  -> target-language generation
  -> isolated compilation/testing
  -> behavioral validation and human approval
```

Everything after verified static knowledge in this target flow is `PLANNED` or `TARGET ARCHITECTURE`, not current executable behavior.
