# Plugin Architecture

> **Status:** `PARTIAL`. At verified core checkpoint `ce36ea8`, the core implements plugin manifests, contracts, registry, loader, lifecycle hooks, and a frozen, capability-empty in-process `PluginContext`. IA-CRIT-001 is `VERIFIED` and core-integrated but **not main-promoted**. Dynamic package discovery, narrow host capability facades, permission manifests, marketplace distribution, process isolation, filesystem/network sandboxing, provider plugins, migration plugins, and validator plugins are `TARGET ARCHITECTURE` and are not implemented.

## Overview

LegacyExodus is intended to evolve across multiple legacy ecosystems, modernization patterns, AI providers, and enterprise validation requirements.
A plugin architecture enables this growth **without destabilizing the core engine**.

The core problem this architecture solves is:

> **How can we add new capabilities without breaking the platform?**

The answer is a **stable-core, contract-first extension model**:

- The core pipeline remains minimal, deterministic, and governed.
- New capabilities are introduced through plugins that implement explicit contracts.
- Future third-party plugins are intended to be isolated, permissioned, and audited; the current loader initializes supplied in-process plugin instances.
- The current initialization context is frozen and exposes no raw Logger, EventBus, StorageManager, service container, or other host capability. This containment is not a process or ambient-runtime sandbox.

LegacyExodus plugin architecture is aligned to the pipeline:

1. **VyrixScout** (discovery)
2. **NolaraStruct** (understanding)
3. **ZelvoxForge** (transformation)
4. **VymosGate** (validation)

---

## 1) Plugin Philosophy

### Target Principles

The principles below describe the target plugin architecture. Current plugins execute in-process with a capability-empty initialization context; they are not sandboxed from ambient Bun/Node authority.

1. **Stable core must remain stable**
   - Core orchestration, trust boundaries, policy engine, and audit model are not modified by plugins at runtime.
   - Core behavior changes only through controlled platform releases.

2. **Extensions must be isolated**
   - Target: plugins execute in controlled runtimes with sandboxing where required.
   - Target: failures degrade gracefully without corrupting core state.

3. **Plugins communicate through contracts**
   - Typed input/output schemas define every integration point.
   - Versioned contracts prevent hidden coupling and breaking behavior.

4. **Plugins cannot bypass governance**
   - Target: policy checks, provenance rules, and validation gates remain mandatory.
   - Target: plugins are subject to permission scopes, resource controls, and audit logging.

### Architecture Principle

```text
Stable Core
    |
    |
Plugin Interface
    |
 ----------------------
 |        |           |
Parser    AI       Validator
Plugin    Plugin   Plugin
```

---

## 2) Plugin Types

LegacyExodus supports official plugin categories. Each type extends capability while preserving core invariants.

### 2.1 Parser Plugins

**Purpose:** Support additional legacy languages and source formats.

**Examples:**
- JavaScript Parser Plugin
- PHP Parser Plugin
- Python Parser Plugin
- Java Parser Plugin

**Typical capabilities:**
- AST generation
- Symbol extraction
- Dependency/reference mapping
- Type/structure hints for NolaraStruct

---

### 2.2 Migration Strategy Plugins

**Purpose:** Provide alternative modernization strategies for different legacy architectures.

**Examples:**
- Monolith Extraction Plugin
- Service Decomposition Plugin
- Database Migration Plugin

**Typical capabilities:**
- Strategy planning
- Rule-based transformation paths
- System boundary recommendation
- Rollout sequencing metadata

---

### 2.3 AI Provider Plugins

**Purpose:** Connect approved model providers through a governed AI gateway.

**Examples:**
- OpenAI Provider
- Local LLM Provider
- Enterprise Model Provider

**Typical capabilities:**
- Model invocation adapters
- Prompt/response normalization
- Provider-specific safety controls
- Token/cost/latency telemetry emission

---

### 2.4 Storage Plugins

**Purpose:** Support extensible persistence backends for artifacts, metadata, and graph/state outputs.

**Examples:**
- PostgreSQL Adapter
- Graph Database Adapter
- Cloud Storage Adapter

**Typical capabilities:**
- Artifact persistence
- Metadata indexing
- Retrieval/query adapter interfaces
- Backup/export integration hooks

---

### 2.5 Validation Plugins

**Purpose:** Add enterprise-specific checks before acceptance or promotion.

**Examples:**
- Security Scanner
- Compliance Validator
- Performance Validator

**Typical capabilities:**
- Rule execution
- Risk scoring
- Policy decision evidence generation
- Pass/fail recommendation with rationale

---

## 3) Plugin Lifecycle

### Current verified lifecycle

The current loader validates the four-field manifest, registers the supplied in-process plugin instance, and invokes `initialize()` with one shared frozen, capability-empty context. If initialization fails, registration is rolled back. Runtime shutdown invokes registered plugins' `shutdown()` hooks. Activation policy, package discovery, permissions, execution isolation, and audit retention are not implemented.

### Target lifecycle

The following controlled lifecycle is `TARGET ARCHITECTURE`:

```text
Plugin Created
      |
      v
Plugin Registered
      |
      v
Plugin Validated
      |
      v
Plugin Activated
      |
      v
Plugin Executed
      |
      v
Plugin Audited
```

### Target Lifecycle Stages

1. **Plugin Created**
   - Plugin package and manifest produced.
   - Contract version declared.

2. **Plugin Registered**
   - Plugin metadata stored in plugin registry.
   - Signature/source integrity recorded.

3. **Plugin Validated**
   - Schema compatibility checks pass.
   - Security policy and permission review pass.
   - Resource profile accepted.

4. **Plugin Activated**
   - Plugin enabled for allowed environments/tenants/stages.
   - Feature flags and rollout constraints applied.

5. **Plugin Executed**
   - Plugin runs only via approved plugin runtime.
   - Inputs/outputs validated at runtime.

6. **Plugin Audited**
   - Execution logs, policy decisions, and artifacts linked to run provenance.
   - Compliance evidence retained per retention policy.

---

## 4) Plugin Contract

### Current verified contract

The current `PluginManifest` contains only `id`, `name`, `version`, and `type`. The current `PluginContext` contains no host capability. Capability declarations, configuration schemas, input/output schemas, security permissions, runtime requirements, and contract-version negotiation are not implemented.

### Target contract

Future plugins are intended to expose a machine-readable contract with, at minimum:

- **Metadata**
- **Configuration**
- **Capabilities**
- **Input Schema**
- **Output Schema**
- **Version**
- **Security Permissions**

### Required Contract Fields

| Field | Description |
|---|---|
| `name` | Unique plugin identifier |
| `version` | Semantic version for plugin package |
| `type` | Official plugin category (`parser`, `migration-strategy`, `ai-provider`, `storage`, `validator`) |
| `capabilities` | Declared capability list |
| `inputSchema` | Versioned schema for accepted input |
| `outputSchema` | Versioned schema for emitted output |
| `configSchema` | Runtime configuration schema |
| `permissions` | Allowed operations/resources |
| `runtime` | Plugin runtime requirements |
| `contractVersion` | Interface/contract compatibility version |

### Example Manifest

```json
{
  "name": "php-parser-plugin",
  "version": "1.0.0",
  "type": "parser",
  "capabilities": [
    "ast-generation",
    "symbol-extraction"
  ],
  "contractVersion": "1",
  "permissions": {
    "filesystem": "read:sandbox-input",
    "network": "deny",
    "secrets": "none"
  }
}
```

### Contract Rules

- Unknown fields may be rejected in strict environments.
- Missing required fields result in registration failure.
- Major contract version mismatch prevents activation.
- Input/output schema violations fail execution.

---

## 5) Plugin Security

Plugin security is mandatory because plugins may process unknown/untrusted legacy content or enterprise-sensitive metadata.

### Current verified boundary

- Plugins execute in-process.
- `PluginContext` is frozen and capability-empty.
- Raw Logger, EventBus, and StorageManager instances are not exposed through the context.
- Current in-repository plugins require no host capability.
- Ambient Bun/Node authority remains available to in-process plugin code.
- Permission manifests, process isolation, filesystem/network sandboxing, resource quotas, and external-plugin trust enforcement are not implemented.
- Any future host interaction requires separately designed, narrow, typed capability facades; raw infrastructure must not be restored for convenience.

### Target security model

```text
External Plugin
      |
      v
Sandbox
      |
      v
Plugin Runtime
      |
      v
LegacyExodus Core
```

### Target Controls

1. **Sandbox execution**
   - Untrusted or third-party plugins execute in isolated runtime boundaries.
   - No direct host-level privilege escalation.

2. **Permissions**
   - Least-privilege access model.
   - Explicit allowlist for filesystem/network/secrets/API scopes.

3. **Resource limits**
   - CPU, memory, time, and I/O quotas.
   - Hard termination on policy breach or runaway behavior.

4. **Validation**
   - Manifest/signature/integrity validation at registration and activation.
   - Runtime schema validation for every invocation.

5. **Trust boundaries**
   - Plugin outputs are treated as untrusted until validated.
   - Plugins cannot directly invoke protected core internals.
   - AI-provider plugins must route through the AI Gateway and policy checks.

### Target Security Non-Negotiables

- No plugin may bypass provenance requirements.
- No plugin may bypass policy decisions (`allow/deny/quarantine`).
- No plugin may bypass VymosGate validation before acceptance.

---

## 6) Plugin Communication

Current plugins receive no host communication capability through `PluginContext`. The following channels are `TARGET ARCHITECTURE` and require separately designed narrow facades:

- **Events** (typed stage events)
- **Contracts** (schema-defined I/O)
- **APIs** (versioned, permission-scoped interfaces)

### Target Prohibitions

- Direct modification of core engine internals
- Hidden dependencies on internal/private core state
- Out-of-band side effects without audit/event emission
- Undeclared network callbacks or uncontrolled IPC paths

### Target Communication Design Rules

1. All plugin I/O must be schema validated.
2. All plugin calls must include provenance context.
3. All plugin results must emit traceable audit events.
4. Core remains source-of-truth for orchestration and governance decisions.

---

## 7) Target Compatibility and Versioning

### Versioning Strategy

- Plugins use semantic versioning (`MAJOR.MINOR.PATCH`).
- Contracts use explicit `contractVersion`.
- Core declares supported contract versions per plugin type.

### Compatibility Rules

- **PATCH/MINOR** updates may auto-upgrade if compatibility checks pass.
- **MAJOR** updates require explicit approval and staged rollout.
- Incompatible plugins are rejected before activation.

### Rollout Guidance

- Canary activation for new plugin versions
- Tenant/stage scoped enablement flags
- Fast rollback path to previously approved version

---

## 8) Target Governance and Auditability

The target architecture requires every plugin action to be attributable and reviewable.

### Minimum Audit Data

- `plugin_name`
- `plugin_version`
- `plugin_type`
- `run_id`
- `tenant_id` (where applicable)
- `input_schema_version`
- `output_schema_version`
- `policy_decision`
- `execution_status`
- `timestamp`

### Governance Outcomes

- Reproducible execution
- Clear failure attribution
- Compliance evidence for enterprise audits
- Safe extensibility without platform drift

---

## 9) Answer to the Main Question

**How can LegacyExodus add new capabilities without breaking the platform?**

The current verified foundation provides a stable core, validated manifests, deterministic registration/lifecycle behavior, and a capability-empty initialization boundary. The target model adds narrow capability facades, sandboxed execution, policy-governed activation, and mandatory auditing. Those future controls are not implemented today.
