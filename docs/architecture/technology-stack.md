## Technology Stack

This document records the final technology decisions for LegacyExodus and explains why each was selected, including major alternatives and tradeoffs.

### Decision Principles

Technology choices were evaluated against these constraints:

- **Safety-first modernization** for unknown/untrusted legacy code
- **Deterministic and auditable pipeline behavior**
- **High developer velocity** for platform iteration
- **Clear migration path** to memory-safe target systems
- **Enterprise readiness** (governance, observability, scale)

---

## 1) Core Platform

### Final Decision
- **TypeScript + Bun**

### Why Chosen
- TypeScript improves correctness and maintainability across a complex orchestration codebase.
- Bun provides fast startup/runtime performance and a streamlined JS/TS toolchain.
- Shared language across orchestration, policy layers, and gateway services reduces cognitive load.
- Strong ecosystem compatibility with schema validation, API tooling, and testing libraries.

### Key Benefits
- Fast iteration for pipeline logic and integrations
- Good type safety for boundary contracts
- Productive developer ergonomics

### Alternatives Considered
- **Node.js + TypeScript**
- **Go**
- **Python**

### Tradeoffs
- Bun ecosystem maturity can lag Node in edge cases.
- Runtime differences require compatibility checks for some packages.
- Go may offer simpler static binaries and predictable runtime behavior.
- Python offers rapid prototyping but weaker static guarantees at scale.

---

## 2) Frontend and Operator Console

### Final Decision
- **React + Vite + Tailwind CSS**

### Why Chosen
- React supports modular UI development for complex operator workflows (pipeline views, policy decisions, validation results).
- Vite provides fast local dev feedback and optimized frontend builds.
- Tailwind enables consistent design primitives and fast UI composition.

### Key Benefits
- Rapid dashboard/tooling development
- Strong ecosystem for data-heavy interfaces
- Efficient implementation of enterprise admin and audit views

### Alternatives Considered
- **Next.js**
- **Svelte/SvelteKit**
- **Vue**

### Tradeoffs
- React can require more architectural discipline (state management complexity).
- Tailwind may produce utility-heavy markup if conventions are not enforced.
- Next.js offers full-stack capabilities but may add framework overhead not required for an operator-focused UI.

---

## 3) Target Modernization Stack (Generated/Transformed Systems)

### Final Decision
- **Rust + Axum + SQLx**

### Why Chosen
- Rust provides memory safety guarantees without garbage collection, aligning with LegacyExodus modernization goals.
- Axum offers a modern, ergonomic async web framework with strong type integration.
- SQLx provides compile-time checked SQL patterns and async database access, reducing runtime query errors.

### Key Benefits
- Strong safety posture for transformed services
- High performance and predictable runtime characteristics
- Type-driven correctness from API to persistence layer

### Alternatives Considered
- **Go + Gin/Fiber + pgx/GORM**
- **Java + Spring Boot**
- **C# + ASP.NET Core + EF Core**

### Tradeoffs
- Rust has a steeper learning curve and longer onboarding for some teams.
- Compile-time guarantees can increase up-front implementation effort.
- Java/C# ecosystems may be easier for enterprises with existing expertise, but typically provide weaker native memory-safety guarantees than Rust.

---

## 4) Database

### Final Decision
- **PostgreSQL**

### Why Chosen
- Mature relational model for provenance, policy, and transformation metadata.
- Strong support for transactional integrity and complex querying.
- Reliable ecosystem for enterprise operations, backups, and observability.
- Extensible features (JSONB, indexing strategies) fit hybrid structured/semi-structured pipeline data.

### Key Benefits
- Strong consistency for audit-critical records
- Flexible schema evolution patterns
- Broad hosting and tooling support

### Alternatives Considered
- **MySQL**
- **SQLite (for limited/local scenarios)**
- **Document stores (e.g., MongoDB)**
- **Graph databases (selective use-case fit)**

### Tradeoffs
- Requires careful schema/index design for high-scale graph-like workloads.
- Operational tuning is needed for very large enterprise throughput.
- Specialized graph DBs may outperform some relationship traversals but add platform complexity.

---

## 5) Cross-Cutting Supporting Technologies

### API Contracts and Validation
- **OpenAPI + Zod (or equivalent runtime schema validators)**
- Rationale: enforce strict input/output contracts at trust boundaries.

### Messaging / Work Orchestration
- **Durable queue/event backbone** (implementation selected per deployment environment)
- Rationale: resilient distributed stage execution and retry semantics.

### Containers and Orchestration
- **OCI containers + Kubernetes (enterprise/cloud)**
- Rationale: isolation, autoscaling, policy enforcement, workload portability.

### Observability
- **OpenTelemetry-compatible tracing/metrics/logging stack**
- Rationale: stage-by-stage latency, safety event visibility, and enterprise monitoring integration.

### Secrets and Identity
- **Managed secret store + workload identity**
- Rationale: short-lived credentials and reduced secret sprawl.

---

## 6) Strategic Tradeoff Summary

### What We Optimize For
- Security and correctness over raw prototyping speed
- Deterministic, auditable behavior over ad hoc flexibility
- Long-term maintainability and safe modernization outcomes

### What We Accept
- Higher initial complexity in strongly typed and policy-driven systems
- Steeper learning curve for Rust target stack
- Additional governance overhead for enterprise-grade controls

---

## 7) Decision Review Cadence

Stack decisions should be reviewed when:

- Security requirements materially change
- Throughput/SLO requirements exceed current platform capabilities
- Enterprise deployment constraints require different operational baselines
- Ecosystem maturity shifts significantly (tooling/runtime support)

All changes must include migration impact, risk assessment, and trust-boundary implications.
