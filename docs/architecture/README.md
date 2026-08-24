# LegacyExodus Architecture

This directory defines the architectural foundation of LegacyExodus: principles, control boundaries, component responsibilities, deployment strategy, scalability direction, and governance model.

## What LegacyExodus Is

LegacyExodus is a knowledge-driven software modernization engine designed to analyze, map, and safely transform complex legacy systems into secure, memory-safe architectures.

It operates through a four-stage pipeline:

1. **VyrixScout** — discovery
2. **NolaraStruct** — structural understanding
3. **ZelvoxForge** — transformation
4. **VymosGate** — validation and governance

---

## Recommended Reading Order

If you are new to the architecture, read in this order:

1. [components/orchestrator.md](./components/orchestrator.md) ⭐
   The execution brain: lifecycle, retries, checkpoints, and stage coordination.

2. [security-architecture.md](./security-architecture.md)
   Trust boundaries and mandatory security controls.

3. [ai-architecture.md](./ai-architecture.md)
   How AI is integrated as governed intelligence without system control.

4. [plugin-architecture.md](./plugin-architecture.md)
   How capabilities expand without destabilizing core behavior.

5. [component-map.md](./component-map.md)
   Component map and stage-to-component relationships.

6. [deployment-model.md](./deployment-model.md)
   Local, enterprise, and cloud execution patterns.

7. [scalability-plan.md](./scalability-plan.md)
   Worker scaling, distributed processing, and enterprise growth strategy.

8. [technology-stack.md](./technology-stack.md)
   Final stack decisions, alternatives, and tradeoffs.

---

## Architecture Map

### Core Architecture Documents

- [security-architecture.md](./security-architecture.md)
- [ai-architecture.md](./ai-architecture.md)
- [plugin-architecture.md](./plugin-architecture.md)
- [deployment-model.md](./deployment-model.md)
- [scalability-plan.md](./scalability-plan.md)
- [technology-stack.md](./technology-stack.md)

### Component Architecture

- [component-map.md](./component-map.md)
- [components/orchestrator.md](./components/orchestrator.md)
- [components/discovery-service.md](./components/discovery-service.md)
- [components/parser-service.md](./components/parser-service.md)
- [components/graph-service.md](./components/graph-service.md)
- [components/knowledge-service.md](./components/knowledge-service.md)
- [components/ai-gateway.md](./components/ai-gateway.md)
- [components/compiler-service.md](./components/compiler-service.md)
- [components/storage-service.md](./components/storage-service.md)
- [components/governance-engine.md](./components/governance-engine.md)

---

## System Control Model (High-Level)

```text
Commands
   |
   v
Orchestrator
   |
   +---- VyrixScout (Discovery Service)
   |
   +---- NolaraStruct (Parser + Graph + Knowledge Services)
   |
   +---- ZelvoxForge (Compiler Service + Governed AI Gateway)
   |
   +---- VymosGate (Governance Engine)
```

---

## Trust-Boundary Contract (Non-Negotiable)

All architecture and implementation paths must preserve:

**Untrusted Legacy Code → Sandbox → Parser → Knowledge Model → AI Gateway**

No component, plugin, or agent may bypass this sequence or governance gates.

---

## Documentation Conventions

- Normative terms use **MUST**, **SHOULD**, **MAY** semantics.
- All major interfaces should define versioned input/output contracts.
- Security, provenance, and auditability requirements are mandatory.
- AI outputs are advisory unless explicitly validated and approved.

---

## Change Management

When updating architecture docs:

1. Update affected component docs and cross-links.
2. Record trust-boundary impact.
3. Update policy/governance implications.
4. Ensure consistency with AI and security architecture.
5. Add ADR references where decisions are materially changed.
