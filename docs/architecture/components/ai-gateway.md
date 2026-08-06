# AI Gateway

## Overview

AI Gateway is the controlled boundary between LegacyExodus and AI model providers. It ensures AI is assistive, policy-governed, and never a control bypass.

## Scope

- model providers
- prompt management
- context engineering
- security boundaries
- AI governance

## Purpose

- Centralize all AI calls through one governed interface.
- Enforce policy, redaction, schema contracts, and auditability.
- Route requests to approved providers based on task and constraints.

## High-Level Flow

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
Provider Route + Prompt Build
      |
      v
Model Response
      |
      v
Schema + Security Validation
```

## Core Responsibilities

1. Model/provider selection and routing
2. Authentication and scoped credentials
3. Prompt template and context assembly
4. Secret/PII redaction and boundary enforcement
5. Response validation and rejection handling
6. Cost, latency, and token governance
7. Full audit logging and traceability

## Model Providers

- GPT provider
- Local LLM provider
- Enterprise model provider

All providers are accessed via provider adapters and standardized contracts.

## Prompt Management

- Template-driven prompt construction
- Strict insertion points for context
- Policy-controlled instruction layers
- Prompt/version lineage for reproducibility

## Context Engineering

Gateway accepts only approved context bundles:

- project context
- knowledge graph slices
- relevant code excerpts
- architecture rules / ADR context

No full-repository dump by default.

## Security Boundaries

- Deny-by-default model/tool policy.
- Secret filtering before outbound request.
- Tenant/data classification-aware routing.
- Response scanning for policy violations.

## Governance

AI outputs are candidates only.  
Downstream execution requires validation and approval flow (as defined by governance engine).

## Failure Handling

- Provider unavailable => fallback/queue/defer by policy.
- Invalid schema => immediate reject.
- Policy violation => quarantine + audit event.
- Low-confidence/high-risk output => human review gate.

## Observability

- Request volume by provider/model
- Cost per run and per stage
- Rejection reasons
- Redaction event rates
- Latency and timeout distributions
