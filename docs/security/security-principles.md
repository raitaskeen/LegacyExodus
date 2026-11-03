# Security Principles & Trust Boundaries

This document defines the core security principles, sandboxing models, and trust boundaries enforced by **LegacyExodus**.

---

## 1. Zero-Trust Static Analysis Principles

```mermaid
flowchart TD
    A[Untrusted Legacy Source Repository] -->|1. Symlink Skip| B[Symlink-Skipping File Traversal]
    B -->|2. Pure AST Parsing| C[Babel Parser Error Recovery]
    C -->|3. SHA-256 Path-Derived IDs| D[Repository-Relative Source Identity]
    D -->|4. Fail-Closed| E[UNRESOLVED Statically Ambiguous Calls]
```

1. **Zero Code Execution:** LegacyExodus never evaluates, runs, or imports target source code during static analysis. Analysis is performed strictly via AST parsing and symbolic traversal.
2. **Symlink-Skipping Traversal:** `FileScanner` skips symbolic-link directory entries encountered during repository traversal. This prevents traversal through those entries, including symlink cycles, duplicate source analysis, and escapes through encountered links; it is not an operating-system sandbox.
3. **Repository-Relative Source Identity:** Discovered source-file paths are normalized relative to the repository for file artifacts, and deterministic file and symbol IDs are derived from path and symbol context. No projection records where the project lives: `project.json` holds no path, and the discovery manifest binds a snapshot to its location only through `repository.locationDigest`, an HMAC of the canonical project path under the local snapshot key (manifest schema 2). Only that key can confirm the location, so a shared `.discovery` reveals no user name or directory layout.
4. **Fail-Closed Conservative Resolution:** When static analysis cannot prove a relationship with certainty, it resolves to `UNRESOLVED` or `null` rather than guessing or fabricating.

---

## 2. Target Architecture Security (Planned)

The following security features are planned for future transformation and compilation phases:
* **VymosGate Sandboxing:** Running target `cargo check` and `cargo test` inside isolated ephemeral containers (gVisor/Docker).
* **Zero-Trust AI Gateway:** Secret token redaction, prompt injection filtering, and token budgeting for LLM interactions.

---

## Related Documentation

* **[Security Architecture](../architecture/security-architecture.md):** Deep architectural security specification.
* **[ADR-006: Security Model](../adr/ADR-006-security-model.md):** Security architecture decision.
* **[GOVERNANCE.md](../../GOVERNANCE.md):** Boundary execution invariants.
