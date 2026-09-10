# AI Architecture

> **Status: TARGET ARCHITECTURE — NOT IMPLEMENTED.** This document describes a future governed AI design. The current core makes no LLM calls and has no AI gateway or agent runtime.

This document defines how AI is integrated into LegacyExodus as a governed capability layer, not a control authority.

## Core Question

**How does AI exist inside LegacyExodus without controlling the system?**

LegacyExodus answers this by combining deterministic orchestration, strict trust boundaries, and policy-governed AI participation.

---

## 1) AI Architecture Philosophy

### Foundational Equation

```text
Deterministic Core
        +
Probabilistic Intelligence
        =
Controlled AI System
```

### Interpretation

AI is used for high-value cognitive tasks:

- reasoning
- planning
- generation
- suggestions

AI is explicitly **not** allowed to control:

- security enforcement
- validation authority
- state integrity guarantees
- final approval and execution authority

### Principle

The platform remains deterministic where correctness, safety, and governance matter most.  
AI contributes intelligence, but the system controls acceptance.

---

## 2) AI System Components

```text
                AI Gateway

                    |
     --------------------------------
     |              |               |
 Model Router   Prompt Engine   Context Manager

                    |

              AI Providers

        ---------------------
        |         |          |
      GPT      Local      Enterprise
```

### Component Summary

- **AI Gateway**: controlled entry/exit for all model interactions.
- **Model Router**: selects provider/model based on policy, task type, cost, and latency constraints.
- **Prompt Engine**: constructs constrained prompts using approved templates and schema expectations.
- **Context Manager**: assembles scoped context from approved sources only.
- **AI Providers**: external or internal model backends (GPT/local/enterprise).

No internal stage may directly call providers outside the AI Gateway.

---

## 3) AI Gateway

### Responsibilities

The AI Gateway is the control plane for model usage and must provide:

- model selection
- authentication and identity propagation
- request lifecycle management
- logging and telemetry
- cost and token control
- policy enforcement

### Request Flow

```text
Agent Request
      |
      v
AI Gateway
      |
      v
Policy Check
      |
      v
Model Provider
      |
      v
Response Validation
```

### Enforcement Expectations

- Deny-by-default for disallowed models/tools.
- Mandatory prompt/output schema contracts.
- Tenant and data-classification aware routing.
- Full audit trace for each model interaction.

---

## 4) Multi-Agent Architecture

LegacyExodus uses specialized agents under orchestrated governance.

### Agent Roles

#### Discovery Agent
**Purpose:** Analyze discovered artifacts and identify high-value modernization targets.

#### Architecture Agent
**Purpose:** Propose target architecture options consistent with platform and policy constraints.

#### Transformation Agent
**Purpose:** Generate candidate migration artifacts/plans under strict contracts.

#### Validation Agent
**Purpose:** Evaluate correctness, policy alignment, and transformation quality signals.

### Agent Topology

```text
                 Orchestrator
                      |
 ------------------------------------------------
 |                  |                  |        |
Discovery Agent  Architecture Agent  Transformation Agent  Validation Agent
```

### Governance Rule

Agents are advisory-capable, not autonomous-authoritative.  
The orchestrator and validation pipeline retain execution control.

---

## 5) Context Engineering

Context quality determines AI quality. LegacyExodus enforces scoped, relevant context delivery.

### Agents Receive

- Project Context
- Knowledge Graph slices
- Relevant Code excerpts
- Architecture Rules
- ADR Decisions

### Agents Do Not Receive

- Entire repository dump
- Unfiltered sensitive artifacts
- Unbounded historical noise
- Data outside tenant/policy scope

### Context Design Goals

- maximize relevance
- minimize leakage risk
- preserve traceability
- keep prompts deterministic where possible

---

## 6) AI Memory Model

AI memory is separated by time horizon and governance level.

### Short-Term Memory

- current task context
- active run artifacts
- in-flight reasoning state (bounded lifespan)

### Long-Term Memory

- project knowledge snapshots
- migration history
- architecture and policy decisions
- transformation and validation artifacts

### Memory Rules

- memory must be versioned
- memory must be auditable
- memory cannot silently change

### Additional Constraints

- memory writes require provenance links
- retention follows data governance policy
- sensitive memory segments require scoped access controls

---

## 7) AI Governance

All AI suggestions pass through controlled decision flow:

```text
AI Suggestion
      |
      v
Evidence Collection
      |
      v
Validation
      |
      v
Human Approval
      |
      v
Execution
```

### Governance Outcomes

- AI output is treated as a candidate, not a command.
- Evidence and validation are mandatory before execution.
- Human approval is required at defined critical gates.

---

## 8) AI Failure Handling

AI failures are expected and must be safely contained.

### Failure Classes

- hallucination
- invalid output format
- unavailable model/provider
- incorrect reasoning or weak justification

### Failure Handling Flow

```text
AI Output
   |
   v
Schema Validation
   |
   v
Rejected?
   |
   v
Human Review
```

### Operational Behavior

- Invalid schema output is auto-rejected.
- Policy-violating outputs are quarantined.
- Model outages trigger fallback routing or deferred execution.
- Low-confidence or high-impact suggestions escalate to human review.

---

## 9) AI Security

AI security controls are mandatory and enforced by architecture, not conventions.

### Required Controls

1. **Prompt injection protection**
   - input sanitization
   - instruction hierarchy enforcement
   - untrusted-content boundary labeling

2. **Source code privacy**
   - data minimization
   - scoped context delivery
   - tenant boundary enforcement

3. **Secret filtering**
   - pre-prompt secret detection and redaction
   - blocked transmission of credential-like data
   - secret-safe logging

4. **Model isolation**
   - provider isolation boundaries
   - policy-based model allowlists
   - restricted tool invocation pathways

5. **Output validation**
   - schema validation
   - policy compliance checks
   - provenance requirements before downstream use

### Security Principle

AI must never become a trust-boundary bypass.  
All interactions remain within the deterministic governance envelope.

---

## 10) Final Position

LegacyExodus treats AI as a governed intelligence layer:

- powerful enough to accelerate modernization,
- constrained enough to preserve correctness and trust.

The system remains controlled because deterministic architecture, policy enforcement, validation, and human approval always outrank probabilistic output.
