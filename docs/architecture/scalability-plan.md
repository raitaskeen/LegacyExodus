## Scalability Plan

This document defines how LegacyExodus scales safely and predictably as repository size, workload concurrency, and enterprise adoption increase.

### Scope

The scalability plan covers:

- Worker scaling
- Distributed processing
- Large repository handling
- Enterprise workload growth

### Architectural Context

LegacyExodus processes untrusted legacy systems through a staged pipeline:

1. **VyrixScout** (discovery/intake)
2. **NolaraStruct** (structural understanding)
3. **ZelvoxForge** (controlled transformation)
4. **VymosGate** (verification)

Trust boundaries remain mandatory at scale:

**Untrusted Legacy Code → Sandbox → Parser → Knowledge Model → AI Gateway**

Scalability strategies must not weaken isolation, provenance, or policy enforcement.

---

## 1) Scaling Objectives

### Primary Objectives

- Maintain safe throughput growth without boundary bypass.
- Keep per-stage latency predictable under burst load.
- Preserve verification quality as transformation volume rises.
- Provide tenant-fair scheduling for enterprise workloads.

### Success Metrics (Examples)

- Pipeline runs completed per hour/day.
- P95 stage latency by workload class.
- Queue wait time by stage and tenant.
- Verification pass/fail stability at increased concurrency.
- Cost per successful modernization run.

---

## 2) Worker Scaling Strategy

### Horizontal Worker Model

Each major stage scales independently via worker pools:

- `vyrixscout-workers`
- `nolara-parse-workers`
- `zelvox-transform-workers`
- `vymos-verify-workers`

Workers should scale based on queue depth, active job age, and resource pressure.

### Autoscaling Signals

- Queue length and oldest message age
- CPU/memory saturation
- I/O wait and artifact store throughput
- Stage-specific timeout/failure trend

### Safety Constraints

- Sandbox and parser workers remain strongly isolated.
- Resource quotas enforced per job and per tenant.
- Hard caps prevent noisy-neighbor starvation.
- Scale-out does not disable policy checks or audit emission.

### Capacity Classes

Define workload classes and route to appropriate worker tiers:

- **S**: small repositories / low complexity
- **M**: medium repositories / moderate graph complexity
- **L**: large repositories / deep dependency graphs
- **XL**: monorepos and enterprise portfolios

---

## 3) Distributed Processing Model

### Decomposition Pattern

Use task decomposition where safe and deterministic:

- Repository-level discovery tasks
- Module/package-level parsing tasks
- Graph segment processing for structure builds
- Batched verification workloads

### Coordination

- Event-driven orchestration via durable queues/topics.
- Idempotent task handlers with retry-safe semantics.
- Checkpointed progress for resumable long-running runs.
- Deterministic merge rules for distributed outputs.

### Data Consistency

- Artifact immutability for intermediate products.
- Versioned Knowledge Model snapshots.
- Provenance links retained across fan-out/fan-in steps.
- Conflict resolution policy for symbol/graph collisions.

### Failure Handling

- Retry transient failures with bounded exponential backoff.
- Quarantine non-deterministic or repeatedly failing partitions.
- Fail closed on trust-boundary or policy violations.
- Preserve partial progress only when integrity constraints pass.

---

## 4) Large Repository Strategy

### Challenges

Large repositories introduce:

- Deep include/import graphs
- Multi-language parsing overhead
- Large binary/history artifacts
- Long validation windows

### Mitigation Techniques

- Pre-filtering and scoped discovery in VyrixScout.
- Incremental parsing with content-hash caching.
- Partitioned graph construction in NolaraStruct.
- Transformation batching by subsystem in ZelvoxForge.
- Parallel verification shards in VymosGate.

### Monorepo Considerations

- Namespace-aware partitioning to avoid cross-domain contamination.
- Shared dependency index with version pinning.
- Policy-aware boundaries between internal products/modules.
- Staged rollout of transformation candidates by ownership domain.

---

## 5) Enterprise Workload Scaling

### Multi-Tenant Scheduling

- Tenant-aware queues and quotas.
- Priority lanes for critical modernization programs.
- Fairness controls to prevent single-tenant dominance.
- Reserved capacity for regulated/high-assurance workloads.

### Governance at Scale

- Policy version pinning by tenant/program.
- Data residency-aware worker placement.
- Centralized audit/event export to SIEM.
- Per-tenant evidence bundles for compliance reviews.

### Portfolio Execution

For enterprises modernizing many systems in parallel:

- Program-level orchestration with dependency maps.
- Reusable structural baselines for similar legacy stacks.
- Shared control libraries for policy and validation templates.
- Controlled wave deployments (pilot → expansion → broad adoption).

---

## 6) Performance Engineering Plan

### Baselines

Establish benchmark suites for:

- Small/medium/large repositories
- Language-family combinations
- High-churn vs stable codebases
- Verification-intensive workloads

### Optimization Priorities

1. Parser throughput and determinism
2. Knowledge model ingest/index performance
3. Transformation candidate generation efficiency
4. Verification parallelism and caching

### Cost Controls

- Adaptive concurrency ceilings by environment.
- Hot-path caching with strict invalidation rules.
- Artifact lifecycle policies (retain evidence, expire transient bulk).
- Budget-aware workload throttling for non-critical runs.

---

## 7) Reliability and Resilience

### Resilience Patterns

- Retry with jitter for transient infra faults.
- Circuit breakers around external dependencies (e.g., model gateways).
- Graceful degradation for non-critical enrichment features.
- Automated rollback for failed deployment waves.

### Disaster and Recovery

- Rebuildable state from immutable artifacts + checkpoints.
- Multi-zone deployment for control plane components.
- Backup and restore drills for metadata and policy stores.
- Recovery time and recovery point objectives defined per environment.

---

## 8) Observability for Scale

### Required Telemetry

- Throughput, latency, and error rates per stage
- Queue depth and processing age
- Worker utilization and saturation
- Policy decision volumes and deny reasons
- Verification confidence and failure categories

### Alerting Priorities

- Sustained queue growth without drain
- Rising parser nondeterminism or timeout rates
- AI boundary redaction/policy failures
- Verification regression trends
- Cross-tenant isolation anomalies

---

## 9) Phased Growth Roadmap

### Phase 1: Foundation
- Single-region, moderate concurrency
- Basic autoscaling and queue controls
- Initial large-repo benchmarks

### Phase 2: Expansion
- Multi-queue tenant-aware scheduling
- Distributed graph/verification processing
- Enhanced caching and checkpoint recovery

### Phase 3: Enterprise Scale
- Multi-region policy-aware placement
- Portfolio-level orchestration
- Advanced fairness, SLO governance, and cost controls

---

## 10) Non-Negotiable Scalability Invariants

At any scale level:

1. Trust boundaries are never bypassed.
2. Untrusted inputs remain sandboxed and isolated.
3. Policy enforcement remains fail-closed.
4. Provenance continuity is preserved across distributed tasks.
5. Verification remains mandatory before acceptance/promotion.
6. Tenant isolation is enforced in compute, storage, and telemetry paths.
