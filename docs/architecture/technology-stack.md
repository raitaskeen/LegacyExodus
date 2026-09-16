# Technology Stack

This document separates the stack that exists in the verified core from technologies that belong only to the product target. It is not a procurement commitment.

## Status summary

| Area | State | Current truth |
|---|---|---|
| Core runtime | `VERIFIED` | Bun 1.4.2 package manager and strict TypeScript |
| Parsing | `VERIFIED` | `@babel/parser` for supported JavaScript/TypeScript/JSX/TSX syntax |
| Contracts | `VERIFIED` | Zod validation and immutable DTO construction |
| Logging | `VERIFIED` | Pino structured logging |
| CLI | `VERIFIED` | Commander-based local CLI |
| Persistence | `VERIFIED` | In-memory and local SQLite storage providers |
| Operator web console | `NOT IMPLEMENTED` | No React/Vite/Tailwind application exists |
| Enterprise PostgreSQL service | `NOT IMPLEMENTED` | No PostgreSQL adapter or service exists |
| Durable distributed queue | `NOT IMPLEMENTED` | Current event delivery is local and synchronous |
| Container/Kubernetes platform | `NOT IMPLEMENTED` | No deployment platform is integrated |
| OpenTelemetry backend | `NOT IMPLEMENTED` | Structured logs do not constitute distributed telemetry |
| Rust/Axum/SQLx generation | `TARGET ARCHITECTURE` | No migration generator exists |
| AI/LLM providers | `NOT IMPLEMENTED` | No AI gateway or provider integration exists |

## Current core stack

The authoritative versions live in `legacy-exodus-core/package.json` and `bun.lock` on `core-foundation`. At the synchronized checkpoint:

- Bun: `1.4.2` package manager, with the declared engine range in package metadata.
- TypeScript: `7.0.2`.
- Babel parser: `8.0.4`.
- Zod: `4.5.4`.
- Commander: `15.0.0`.
- Pino: `10.3.1`.
- SQLite: Bun's local SQLite API behind the storage-provider boundary.

The core is a local deterministic analysis application. It does not require a database server, message broker, browser UI, container orchestrator, or cloud service.

## Selection principles

Current and future technology choices must preserve:

- deterministic and auditable behavior;
- strict boundary validation;
- conservative handling of unresolved program behavior;
- repository-local operation for the supported core;
- replaceable adapters rather than infrastructure knowledge in domain analysis;
- evidence before capability claims.

## Target architecture

Rust, Axum, and SQLx remain possible target technologies for generated systems. PostgreSQL, distributed work orchestration, an operator console, containers, managed secrets, and observability backends may be evaluated for future enterprise deployment. They become `IMPLEMENTED` only after code is integrated and become `VERIFIED` only after executable evidence passes.

No target technology in this section changes the current product boundary described in [Current Implementation](../CURRENT_IMPLEMENTATION.md).
