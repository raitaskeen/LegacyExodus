# Runtime Architecture

## Current runtime

LegacyExodus runs as a local in-process Bun application. `createLegacyExodusEngine()` composes dependencies; `LegacyExodusEngine` owns the public lifecycle; `ApplicationRuntime` starts and stops registered services.

```text
CLI
  -> createLegacyExodusEngine
  -> initialize
  -> execute command
  -> orchestrator / analysis services
  -> storage and projections
  -> shutdown
```

### Lifecycle

- Engine: `created -> running -> stopping -> stopped`.
- Runtime: validates configuration, creates structured logging, starts services, and performs reverse-order cleanup.
- Concurrent shutdown calls coalesce; in-flight engine executions settle before runtime cleanup.
- A stopped engine instance cannot restart.

### Execution

Commands are validated at contract boundaries and dispatched through the engine/orchestrator. Project analysis executes discovery, per-file parser/symbol work, graph/semantic/flow construction, event publication, atomic run-scoped persistence, and projection for fresh runs. Recoverable per-file failures are categorized; terminal failures remain observable.

The current orchestrator is deterministic in-process coordination. It is not a distributed task queue and does not provide general retry scheduling, worker leases, or remote execution.

### Events

The event bus publishes synchronously in registration order. The in-memory event store preserves append order for replay. The durable journal records committed execution facts. This is an event-driven architecture; it should not be described as a complete distributed event-sourcing platform.

### Storage

The runtime injects either memory or SQLite storage behind `StorageManager`. SQLite configuration is local and embedded. Projection output is derived from validated completed-run records and published beneath the analyzed project's `.discovery/` directory.

### Plugins

The runtime composes an in-process plugin registry/loader and scoped plugin context. Dynamic package discovery, third-party sandboxing, marketplace distribution, and permission isolation are not implemented.

## Current non-goals

- No network service or REST API.
- No distributed worker pool or multi-tenant scheduler.
- No AI/model-provider runtime.
- No transformation, Rust generation, or compilation sandbox.
- No hosted telemetry/control plane.

## Target runtime

Future designs may introduce bounded worker execution, checkpointing, isolated compilation, policy services, observability, and distributed/multi-tenant operation. Those require separate contracts and evidence and remain `TARGET ARCHITECTURE`.
