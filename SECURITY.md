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
* **Manifest Path Containment (SEC-02):** Discovery manifest artifact path validation enforces lexical containment (`isPathWithinDirectory`), physical canonicalization (`realpath()`), and symlink rejection (`lstat()`). The validation is hardened against the investigated traversal and symlink-escape threat model (theoretical same-privilege local filesystem TOCTOU races remain outside the current threat model).
* **Storage Immutability (DAT-01):** Persistent and in-memory storage record payloads are recursively deep-frozen (`deepFreeze()`), ensuring complete payload immutability across nested objects, arrays, and matrices without identified residual risk within the investigated SQLite deserialization boundary.
* **Bounded Projections:** Projections write atomically to `.discovery/` using random UUID temporary files and atomic file replacement with SHA-256 verification.
* **Deterministic Storage:** Persistent SQLite storage runs with foreign keys enabled, WAL mode, transaction wrapping, and explicit schema compatibility validation.
* **CI/CD Security:** All GitHub Actions workflows enforce `permissions: contents: read` by default, with scoped write permissions granted only when required for security artifact analysis.
