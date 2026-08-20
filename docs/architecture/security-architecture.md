## Security Architecture Compliance Matrix

> **Target-state design, not current enforcement.** The current engine performs deterministic local static analysis and does not implement a sandbox, AI Gateway, secret redaction, tenant isolation, archive-bomb defense, malware scanning, or hosted execution controls. The controls below are mandatory requirements for those planned subsystems.

This section converts the trust-boundary architecture into enforceable controls, required evidence, and fail-closed rules.

### Target Trust Boundary (Normative for Future Implementations)

All processing in LegacyExodus **MUST** follow this sequence:

1. **Untrusted Legacy Code**
2. **Sandbox**
3. **Parser**
4. **Knowledge Model**
5. **AI Gateway**

No component may bypass these boundaries. In particular, transformation systems (including ZelvoxForge) **MUST NOT** consume raw legacy inputs directly and **MUST** operate only on approved downstream artifacts.

---

### 1) Boundary-by-Boundary Compliance Matrix

| Boundary | Allowed Input | Required Controls | Required Output | Must-Fail Conditions | Required Audit Events |
|---|---|---|---|---|---|
| **Untrusted Legacy Code → Sandbox** | Raw files, repositories, archives, binaries from customer/enterprise sources | File-type allowlist, size limits, archive bomb detection, malware scan, path traversal prevention, default deny on network egress | Immutable sandbox artifact set + intake manifest | Traversal entries (`../`), expansion over threshold, untrusted executable behavior, disallowed artifact classes | `sandbox.intake.started`, `sandbox.intake.blocked`, `sandbox.intake.completed` |
| **Sandbox → Parser** | Read-only sandbox artifacts only | Process isolation, read-only mounts, CPU/memory/time quotas, deterministic parser mode, dependency pinning | Parsed IR fragments + diagnostics | Outbound network attempts, timeout/OOM, deterministic mismatch above threshold | `parser.run.started`, `parser.run.failed`, `parser.run.completed` |
| **Parser → Knowledge Model** | Parsed IR + provenance metadata | Strict schema validation, required provenance fields, taint-label propagation, integrity hash chaining | Versioned Knowledge Model snapshot | Missing provenance, schema mismatch, unresolved critical graph errors | `km.ingest.started`, `km.ingest.rejected`, `km.ingest.completed` |
| **Knowledge Model → AI Gateway** | Sanitized, policy-approved model slices only | Field-level redaction, secret/PII detection, tenant/legal policy checks, schema-constrained prompt contract, token budget controls | Prompt package + policy decision receipt | Secret/PII leakage risk above threshold, policy deny, missing redaction evidence | `aigw.request.blocked`, `aigw.request.redacted`, `aigw.request.sent` |
| **AI Gateway → Downstream Stages** | Structured model output only | Schema validation, tool-call allowlist, confidence threshold checks, deny free-form executable actions | Constrained transformation hints/plans | Invalid schema, disallowed tool call, confidence below gate | `aigw.response.rejected`, `aigw.response.accepted` |
| **ZelvoxForge → VymosGate** | Candidate transforms + provenance chain | Signed transformation bundles, compliance checks, semantic equivalence tests, memory-safety checks | Verification-ready transformation package | Missing provenance link, unverifiable step, policy violation | `forge.bundle.created`, `gate.validation.failed`, `gate.validation.passed` |

---

### 2) Security Control Domains

#### AI Security
- AI I/O **MUST** be schema-first and validated.
- AI **MUST NOT** receive raw untrusted legacy content.
- Tool invocation **MUST** be allowlisted and deny-by-default.
- Prompt/response handling **MUST** follow tenant-scoped retention and encryption controls.

#### Sandboxing
- Intake and parsing workloads **MUST** run in ephemeral isolated environments.
- Source mounts **MUST** be read-only.
- Network egress **MUST** be disabled unless explicitly policy-approved.
- Runtime quotas **MUST** enforce hard termination on limit exceedance.

#### Secrets Management
- Secret scanning **MUST** occur at intake and before AI boundary crossing.
- Secrets **MUST NOT** appear in prompts, logs, or telemetry payloads.
- Redaction evidence **MUST** be attached to each AI request.
- Service credentials **SHOULD** be short-lived and identity-bound.

#### Enterprise Data Protection
- Tenant isolation **MUST** be enforced for storage, execution, and AI request context.
- Data classification labels **MUST** propagate across all pipeline artifacts.
- Encryption in transit and at rest **MUST** be enabled.
- Regional residency policies **MUST** be validated before model dispatch.

#### Trust Boundary Enforcement
- Every boundary decision **MUST** be explicit: `allow`, `deny`, or `quarantine`.
- Every boundary transition **MUST** preserve provenance continuity.
- Policy evaluations **MUST** reference versioned policy identifiers.

---

### 3) Executable Invariants (Implementation Requirements)

The implementation **MUST** enforce these invariants:

1. `RawLegacyInput` cannot be passed to AI Gateway interfaces.
2. `SandboxArtifact` must include `manifestHash` and source provenance.
3. `ParsedIR` ingestion requires exact `schemaVersion` compatibility.
4. `KnowledgeSlice` sent to AI must include `redactionReportId`.
5. `TransformBundle` must be signed and linked to upstream artifact hashes.
6. Missing provenance continuity at any step results in hard failure.

---

### 4) Required Telemetry and Audit Evidence

Each run **MUST** produce auditable records including:

- `run_id`
- `tenant_id`
- `stage`
- `artifact_hash`
- `policy_id`
- `policy_version`
- `decision` (`allow|deny|quarantine`)
- `reason`
- `service_identity`
- `timestamp`

Recommended evidence bundle:

- Sandbox configuration snapshot
- Parser resource and diagnostics report
- Knowledge Model schema validation report
- Redaction/classification report
- AI policy decision receipt
- Transformation verification report

---

### 5) Verification and Test Strategy

#### Unit Tests
- Boundary validators reject malformed and tainted payloads.
- Redaction removes secrets/PII using deterministic fixtures.
- Schema mismatches fail immediately.

#### Integration Tests
- End-to-end hostile sample intake through fail-closed outcomes.
- Provenance continuity validated across all stages.
- Tenant isolation validated under concurrent execution.

#### Adversarial and Chaos Tests
- Prompt injection in comments, strings, and metadata.
- Archive bombs and parser crash corpora.
- Policy service outage simulation with required fail-closed behavior.

#### Release Gates
- Any increase in measured leakage risk blocks release.
- Any reduction in validation coverage blocks release.

---

### 6) Explicit Must-Fail Scenarios

The system **MUST** fail closed for the following:

1. VyrixScout accepts traversal-capable or expansion-bomb archives.
2. NolaraStruct ingests IR missing required provenance fields.
3. AI Gateway receives unredacted credentials or sensitive tokens.
4. ZelvoxForge emits transformations without source mapping/provenance.
5. VymosGate cannot establish semantic equivalence or memory-safety criteria.
6. Any attempted cross-tenant data access.

All failures **MUST** emit high-severity audit events and require controlled human override procedures where applicable.

---

### 7) Policy Object Model (Recommended)

Adopt versioned policy objects:

- `SecurityPolicy`
- `DataHandlingPolicy`
- `AIGatewayPolicy`
- `TransformationPolicy`
- `ValidationPolicy`

All enforcement decisions should store `policy_id` and `policy_version` for reproducibility and auditability.
