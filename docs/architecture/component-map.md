# Component Map

See [Current Implementation](../CURRENT_IMPLEMENTATION.md) for the core SHA used as executable evidence.

## Current components

| Component | State | Responsibility |
|---|---|---|
| CLI | `VERIFIED` | Command registration, option validation, human/JSON presentation, error boundary |
| LegacyExodusEngine | `VERIFIED` | Public lifecycle and command-execution facade |
| ApplicationRuntime | `VERIFIED` | Configuration, logger, service startup/shutdown, cleanup |
| Orchestrator / command handlers | `VERIFIED` | Deterministic project-analysis sequencing, events, record persistence |
| Event bus/store/journal | `VERIFIED` | Synchronous publication, replayable in-memory events, durable append journal |
| Discovery | `VERIFIED` | Repository inventory, classification, dependency/framework signals, failure accounting |
| Parser registry/manager + Babel adapter | `VERIFIED` | Supported JS/TS parse selection and normalized AST generation |
| Symbol extraction | `VERIFIED` | Lexical symbols and selected ESM/CommonJS relationships |
| Module/dependency graph | `VERIFIED` | Conservative repository-local resolution, re-exports, cycles |
| Knowledge graph | `VERIFIED` | Deterministic file/symbol structural graph |
| Semantic analysis | `PARTIAL` | Conservative references, calls, entry points, routes/middleware for supported patterns |
| Flow analysis | `PARTIAL` | CFG, DFG, proven interprocedural transfer, conservative taint facts |
| StorageManager/providers | `VERIFIED` | Memory/SQLite persistence, scoped queries, transactions and lifecycle |
| Projection services | `VERIFIED` | Validated, contained, atomic `.discovery` artifacts |
| Plugin runtime | `IMPLEMENTED` | In-process contracts, context, registry and loader foundation |
| Fidelity/benchmark governance | `IMPLEMENTED` | Sample-based evidence and repository benchmark checks |

No current component performs source transformation, migration planning, AI inference, target-language generation, generated-code compilation, or deployment.

## Current dependency direction

```text
CLI
  -> Engine
     -> Runtime composition
     -> Orchestrator
        -> discovery/parser/symbol/graph/semantic/flow services
        -> event infrastructure
        -> StorageManager
           -> provider
           -> projection service
```

Analysis services depend on contracts and injected collaborators rather than CLI presentation or a concrete external database.

## Target components

| Component | State |
|---|---|
| Language-independent IR/SSA | `TARGET ARCHITECTURE` |
| Migration planner/refactor engine | `TARGET ARCHITECTURE` |
| AI Gateway and model providers | `TARGET ARCHITECTURE` |
| ZelvoxForge generation workers | `TARGET ARCHITECTURE` |
| VymosGate compiler/equivalence sandbox | `TARGET ARCHITECTURE` |
| Enterprise policy/approval service | `TARGET ARCHITECTURE` |
| Distributed/multi-tenant execution | `TARGET ARCHITECTURE` |
| Dashboard/control plane | `TARGET ARCHITECTURE` |

Target components must not be listed as runtime dependencies until integrated code and executable evidence exist.
