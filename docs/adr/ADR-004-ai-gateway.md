# ADR-004 — Zero-Trust AI Gateway & Prompt Isolation

## Status
**PROPOSED / TARGET ARCHITECTURE** (Planned for Stage 3 ZelvoxForge)

## Context
When transforming legacy codebases to memory-safe modern architectures (such as Rust/Axum), LLM interactions must be heavily guarded against prompt injection, sensitive secret leakage, token budget exhaustion, and topological hallucinations.

Key challenges:
1. Preventing hardcoded enterprise secrets and credentials in legacy code from being sent to external LLMs.
2. Grounding LLM prompts with deterministic static analysis context from NolaraStruct rather than feeding unverified raw files.
3. Managing model provider failover, rate limits, and latency.

## Decision (Planned Target Architecture)
1. **Isolated AI Gateway:** Implement an AI Gateway proxy (`docs/architecture/components/ai-gateway.md`) that mediates all outbound LLM generation requests.
2. **Automated Secret Redaction:** Redact detected API keys, passwords, and PII before prompt compilation.
3. **Deterministic Context Slicing:** Construct LLM prompt payloads strictly from verified knowledge graph slices (symbols, call graphs, CFGs) produced by NolaraStruct.

## Alternatives Considered
* **Direct Client-Side LLM SDK Calls:** Rejected because direct calls lack audit logging, token budgeting, and secret redaction controls.
* **Unstructured Full-File Prompt Ingestion:** Rejected because raw file prompting leads to severe topological hallucinations and context limit truncation.

## Consequences
* **Positive:** Complete Zero-Trust governance and auditability for automated code generation.
* **Positive:** Reduces token costs by providing filtered structural context slices.
* **Tradeoff:** Adds an architectural proxy layer between transformation agents and LLM providers.

## Implementation Evidence / Status
* **Status:** This is target architecture for future transformation milestones and is **not present** in the current Bun static analysis core.

## Related Documentation
* **[AI Architecture](../architecture/ai-architecture.md):** High-level AI subsystem design.
* **[AI Gateway Component Specification](../architecture/components/ai-gateway.md):** Component specification.
