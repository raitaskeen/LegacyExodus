# Governance Engine (VymosGate Core)

> **Status: TARGET ARCHITECTURE — NOT IMPLEMENTED AS VYMOSGATE.** Current benchmark/fidelity governance is narrower and does not approve generated migrations.

## Overview

Governance Engine is the authoritative policy and validation authority for modernization acceptance decisions in LegacyExodus.

## Scope

- policies
- approvals
- confidence scoring
- audit trail
- compliance checks

## Purpose

- Evaluate modernization outputs against defined policy and quality rules.
- Produce explicit allow/deny/quarantine decisions.
- Require human approval at designated critical gates.
- Maintain compliance-grade audit evidence.

## Decision Flow

```text
Candidate Output
      |
      v
Policy Evaluation
      |
      v
Confidence Scoring
      |
      v
Compliance Checks
      |
      v
Approval Workflow
      |
      v
Final Decision (Allow / Deny / Quarantine)
```

## Core Responsibilities

1. Policy loading/version enforcement
2. Rule execution across security, correctness, compliance
3. Confidence scoring of transformation and validation evidence
4. Human approval orchestration for gated decisions
5. Audit trail generation and retention

## Policy Domains

- Security policy
- AI governance policy
- Transformation safety policy
- Validation quality policy
- Enterprise compliance policy

## Approvals

- Configurable approval gates by risk/impact level.
- High-impact or low-confidence changes require explicit human approval.
- Break-glass flow must be auditable and time-bounded.

## Confidence Scoring

Confidence combines signals from:

- parsing/graph/knowledge completeness
- transformation determinism
- compile and static validation outcomes
- policy violation severity
- historical reliability indicators

Scores must include interpretable rationale and thresholds.

## Compliance Checks

- Trust-boundary adherence
- Provenance continuity
- Security controls and secret hygiene
- Architecture/rule conformance
- Tenant/governance constraints

## Audit Trail (Required Fields)

- `run_id`
- `candidate_id`
- `policy_id` + `policy_version`
- `decision`
- `confidence_score`
- `violations`
- `approver_identity` (if applicable)
- `timestamp`

## Failure Handling

- Missing required evidence => deny/quarantine.
- Policy engine unavailable => fail closed.
- Ambiguous decision context => route to human review, no auto-allow.

## Observability

- decision distribution (allow/deny/quarantine)
- approval latency
- policy violation trends
- confidence-score drift over time
- compliance pass/fail rates
