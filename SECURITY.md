# Security Policy

## Reporting Security Vulnerabilities

We take the security of LegacyExodus seriously. If you discover a vulnerability or security flaw, please report it responsibly to the core maintainers rather than filing a public issue.

### Private Disclosure Process

1. **Email:** Send details to the maintainers at `raitaskeen.dev@gmail.com` and `raimrazzaq12@gmail.com`.
2. **Details to Include:**
   - Detailed description of the vulnerability and affected components.
   - Minimal reproduction steps, proof of concept, or command execution log.
   - Assessment of potential impact (e.g. data tampering, secret exposure, command injection).
3. **Response Timeline:**
   - Maintainers will acknowledge receipt within 48 hours.
   - A triage assessment and coordinated fix plan will be communicated within 7 business days.

Please do **NOT** open public GitHub issues or discussions for unpatched security vulnerabilities.

---

## Security Architecture & Best Practices

LegacyExodus applies strict least-privilege principles across its execution pipeline:
* **Subprocess Isolation (SEC-01):** Git revision lookups invoke Git directly with explicit argument arrays and `shell: false`, eliminating shell interpretation risk at the investigated Git subprocess boundary.
* **Manifest Path Containment (SEC-02):** Discovery manifest artifact path validation enforces lexical containment (`isPathWithinDirectory`), physical canonicalization (`realpath()`), and symlink rejection (`lstat()`).
* **Discovery Root & Manifest Symlink Boundary (SEC-03):** The `.discovery` root directory and `manifest.json` are strictly verified via `lstat()` to reject symbolic links, and their physical paths (`realpath()`) must reside strictly within the target repository workspace boundary.
* **In-Memory Validated Byte Consumption (REUSE-03):** Discovery snapshot validation returns verified in-memory byte contents (`validatedArtifacts`), which the orchestrator consumes directly, eliminating any time-of-check to time-of-use (TOCTOU) file tampering window between manifest verification and JSON parsing.
* **Storage Immutability (DAT-01):** Persistent and in-memory storage record payloads are recursively deep-frozen (`deepFreeze()`), ensuring complete payload immutability across nested objects, arrays, and matrices without identified residual risk within the investigated SQLite deserialization boundary.
* **Bounded Projections:** Projections write atomically to `.discovery/` using random UUID temporary files and atomic file replacement with SHA-256 verification.
* **Deterministic Storage:** Persistent SQLite storage runs with foreign keys enabled, WAL mode, transaction wrapping, and explicit schema compatibility validation.
* **CI/CD Security:** Current implementation workflows use immutable action commit pins, least-privilege permissions, disabled checkout credential persistence, frozen Bun installs, job timeouts, and concurrency cancellation. The labeler alone receives `pull-requests: write` so it can apply labels; core verification and documentation jobs use `contents: read`.

### Hosted Security Tooling Boundary

CodeQL and Dependency Review are not available under the current private-repository/account configuration. The unusable historical CodeQL workflow was intentionally removed from current main/core workflow truth. This limitation does not weaken the reporting process above, and it must not be interpreted as proof that the codebase is vulnerability-free.
