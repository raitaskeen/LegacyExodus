## Deployment Model

This document defines how LegacyExodus is executed across local, enterprise, and cloud environments, including containerization and CI/CD integration.

### Scope

LegacyExodus deployment supports:

- Local developer execution
- Enterprise self-hosted deployment
- Cloud-managed deployment
- Containerized workloads
- CI/CD automation and policy gates

### Runtime Architecture

LegacyExodus runs as a staged modernization pipeline with strict trust boundaries:

1. **VyrixScout** (discovery and intake)
2. **NolaraStruct** (structural understanding and modeling)
3. **ZelvoxForge** (controlled transformation)
4. **VymosGate** (verification and validation)

Core boundary flow:

**Untrusted Legacy Code → Sandbox → Parser → Knowledge Model → AI Gateway**

No deployment mode may bypass this flow.

---

## 1) Local Developer Setup

### Goals

Local mode is optimized for repeatable development, testability, and safe handling of untrusted code samples.

### Required Components

- Container runtime (Docker or compatible OCI runtime)
- Language/toolchain dependencies used by each stage
- Local policy configuration
- Optional local model gateway mock for offline tests

### Recommended Setup

- Run each stage as an isolated service/container.
- Mount legacy inputs as read-only.
- Use ephemeral working directories for parser and transformation outputs.
- Keep secrets in environment-specific secret stores (never in repository files).
- Use reduced-size fixture repositories for deterministic local runs.

### Developer Workflow (Typical)

1. Start local dependencies and service containers.
2. Run VyrixScout against fixture or target sample.
3. Validate generated structural artifacts from NolaraStruct.
4. Execute constrained transformation plans in ZelvoxForge.
5. Run VymosGate verification suite and inspect reports.
6. Export evidence bundle for debugging/comparison.

### Local Security Defaults

- Network egress disabled by default for sandbox/parser containers.
- Strict resource limits (CPU, memory, timeout).
- Verbose audit logging enabled in non-production local mode.

---

## 2) Enterprise Deployment (Self-Hosted)

### Goals

Enterprise mode prioritizes governance, tenant isolation, auditability, and controlled model access.

### Topology

- Deployed into customer-managed infrastructure (Kubernetes or VM-based orchestration).
- Stage services separated by trust boundary.
- Dedicated policy, audit, and secrets management services.
- Optional private model gateway / approved external model broker.

### Control Expectations

- SSO/RBAC integrated with enterprise identity provider.
- Tenant/data domain isolation across storage and execution namespaces.
- Encryption at rest and in transit.
- Region and data residency controls.
- Centralized SIEM export for security events.

### Enterprise Operational Requirements

- Versioned policy bundles (security, AI, transformation, validation).
- Immutable artifact storage for provenance and replay.
- Break-glass workflow with explicit approvals and audit trails.
- Backup/restore and disaster recovery runbooks.

---

## 3) Cloud Deployment (Managed)

### Goals

Cloud mode provides scalable, managed execution while preserving enterprise-grade controls.

### Reference Characteristics

- Auto-scaling worker pools per stage.
- Managed queue/event backbone for pipeline orchestration.
- Isolated sandbox workers for untrusted code handling.
- Managed secret and key infrastructure.
- Central policy decision points for AI and transformation gates.

### Cloud Security Posture

- Zero-trust service-to-service identity.
- Per-run ephemeral credentials and scoped permissions.
- Policy-enforced model routing and redaction controls.
- Continuous vulnerability scanning for images and dependencies.

### Scalability Considerations

- Horizontal scaling for parser and validation-intensive workloads.
- Workload class separation (small/medium/large codebases).
- Backpressure and queue controls for burst ingestion events.

---

## 4) Containerization Model

### Container Principles

- One primary responsibility per container/service.
- Minimal base images and pinned dependencies.
- Read-only root filesystem where feasible.
- Non-root execution by default.
- Reproducible builds with digest-pinned images.

### Suggested Service Containers

- `vyrixscout-service`
- `nolara-struct-service`
- `zelvox-forge-service`
- `vymos-gate-service`
- `policy-engine`
- `ai-gateway`
- `audit-exporter`

### Sandbox Container Profile (Critical)

- No privileged mode.
- No host networking.
- No host PID/IPC namespace sharing.
- Strict seccomp/AppArmor (or equivalent) profiles.
- Hard resource limits and termination on violation.

---

## 5) CI/CD Deployment Model

### Pipeline Objectives

CI/CD must validate both functionality and safety before promotion.

### Recommended CI/CD Stages

1. **Static checks**: lint, type-check, formatting.
2. **Security checks**: SAST, dependency scan, secret scan.
3. **Build**: deterministic container/image builds.
4. **Test**: unit + integration + adversarial tests.
5. **Policy gates**: trust-boundary, redaction, provenance checks.
6. **Artifact signing**: image and bundle signing.
7. **Promotion**: environment-specific deploy approvals.
8. **Post-deploy validation**: smoke tests + audit pipeline checks.

### Required Release Gates

- No critical security findings unresolved.
- Provenance chain validation passes.
- AI boundary leakage tests pass.
- Verification quality thresholds meet policy.
- Signed artifacts only in deployable set.

### Deployment Strategies

- Dev: frequent rolling updates.
- Staging: canary plus verification soak window.
- Production: controlled rollout with automated rollback criteria.

---

## 6) Environment Profiles

### Development
- Fast feedback, debug logs enabled, representative but reduced datasets.

### Staging
- Production-like topology with stricter policy and full integration tests.

### Production
- Full policy enforcement, hardened runtime, complete audit and SIEM export.

---

## 7) Observability and Operations

### Required Signals

- Pipeline throughput and latency by stage.
- Policy decision rates (`allow/deny/quarantine`).
- Verification pass/fail distributions.
- Sandbox/parser failure reasons.
- AI gateway rejection/redaction metrics.

### Operational SLO Themes

- Pipeline completion reliability
- Verification correctness confidence
- Mean time to detect and contain unsafe transformations

---

## 8) Deployment Non-Negotiables

Across all modes (local, enterprise, cloud), the following are mandatory:

1. Trust-boundary order is preserved.
2. Untrusted inputs are sandboxed before parsing.
3. AI receives only policy-approved, sanitized model slices.
4. Transformations require provenance continuity.
5. Verification is required before promotion/use.
6. Security policy violations fail closed.
