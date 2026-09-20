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
* **Manifest Artifact Path Containment (SEC-02):** For artifacts declared by a discovery manifest, validation rejects lexically escaping names (`isPathWithinDirectory`), symbolic-link artifact paths (`lstat()`), and canonical artifact paths (`realpath()`) outside the selected discovery directory.
* **Discovery Root & Manifest Symlink Boundary (SEC-03):** Validation rejects a symbolic-link `.discovery` root and symbolic-link `manifest.json`. When canonical paths are available, it checks that the manifest remains within the selected discovery directory; for the default `.discovery` location, it also checks that the canonical discovery directory remains within the canonical project directory. A caller-supplied custom discovery directory is not required to reside within the project directory, and root/project/manifest canonicalization failures are not universally fail-closed in the current implementation.
* **In-Memory Validated Byte Consumption (REUSE-03):** Successful discovery snapshot validation retains validated artifact contents in `validatedArtifacts`, and the orchestrator parses the required snapshot JSON from those retained strings without reopening the artifact files. This removes the specific post-validation filesystem re-read window between successful artifact validation and `JSON.parse`; it is not a claim that every filesystem TOCTOU risk is eliminated.
* **Storage Immutability (DAT-01):** Persistent and in-memory storage record payloads are recursively deep-frozen (`deepFreeze()`), ensuring complete payload immutability across nested objects, arrays, and matrices without identified residual risk within the investigated SQLite deserialization boundary.
* **Bounded Projections:** Projections write atomically to `.discovery/` using random UUID temporary files and atomic file replacement with SHA-256 verification.
* **Deterministic Storage:** Persistent SQLite storage runs with foreign keys enabled, WAL mode, transaction wrapping, and explicit schema compatibility validation.
* **CI/CD Security:** Current implementation workflows use immutable action commit pins, least-privilege permissions, disabled checkout credential persistence, frozen Bun installs, job timeouts, and concurrency cancellation. The labeler alone receives `pull-requests: write` so it can apply labels; core verification and documentation jobs use `contents: read`.

### Hosted Security Tooling Boundary

CodeQL and Dependency Review are not available under the current private-repository/account configuration. The unusable historical CodeQL workflow was intentionally removed from current main/core workflow truth. This limitation does not weaken the reporting process above, and it must not be interpreted as proof that the codebase is vulnerability-free.
