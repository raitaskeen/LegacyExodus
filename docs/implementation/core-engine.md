# Core Engine Boundary

## Purpose

`LegacyExodusEngine` is the single public boundary between interfaces and the deterministic core. The CLI invokes engine lifecycle, health, command execution, and plugin-list operations without importing storage, event, runtime, or plugin internals.

## Composition and Ownership

`src/runtime/composition/services.ts` creates the dependency graph: runtime configuration and logging, in-memory storage, event store and bus, plugin registry and loader, orchestrator, and `ApplicationRuntime`. The resulting `EngineContext` is owned privately by the engine.

## Lifecycle

The engine transitions from `created` to `running` through `initialize()`. Initialization starts the runtime after all dependencies have been composed. `shutdown()` stops the runtime and transitions the engine to `stopped`; stopped engine instances are not restarted.

## Health and Commands

`status()` returns stable component health for runtime, storage, plugins, and events. `execute()` currently supports only `SystemStatusCommand`. Future engine commands must use this façade rather than exposing internal subsystem APIs to the CLI.
