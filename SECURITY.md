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
* **Bounded Projections:** Projections write only to `.discovery/` with isolated checksum verification.
* **Deterministic Storage:** Persistent SQLite storage runs with foreign keys enabled, WAL mode, transaction wrapping, and explicit schema compatibility validation.
* **CI/CD Security:** All GitHub Actions workflows enforce `permissions: contents: read` by default, with scoped write permissions granted only when required for security artifact analysis.
