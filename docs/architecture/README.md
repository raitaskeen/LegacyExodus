# LegacyExodus Architecture

This directory defines the architectural foundation of LegacyExodus: principles, control boundaries, component responsibilities, deployment strategy, scalability direction, and governance model.

Architecture documents contain both executable current design and future design. Every capability claim must use the state vocabulary in root `AGENTS.md`; [Current Implementation](../CURRENT_IMPLEMENTATION.md) is the concise synchronization boundary.

## What LegacyExodus Is

LegacyExodus currently provides deterministic local JavaScript/TypeScript repository intelligence and static analysis. It is designed to evolve into a governed modernization platform; transformation and generated-system validation are target architecture.

It operates through a four-stage pipeline:

1. **VyrixScout** — discovery (`IMPLEMENTED`)
2. **NolaraStruct** — structural understanding (`PARTIAL`)
3. **ZelvoxForge** — transformation (`TARGET ARCHITECTURE`)
4. **VymosGate** — validation and governance (`TARGET ARCHITECTURE`)

---

## Recommended Reading Order

If you are new to the architecture, read in this order:

1. [components/orchestrator.md](./components/orchestrator.md) ⭐
   Current analysis coordination plus clearly marked target lifecycle, retry, checkpoint, and four-stage responsibilities.

2. [security-architecture.md](./security-architecture.md)
   Trust boundaries and mandatory security controls.

3. [ai-architecture.md](./ai-architecture.md)
   `TARGET ARCHITECTURE` for a governed AI boundary; AI is not integrated.

4. [plugin-architecture.md](./plugin-architecture.md)
   How capabilities expand without destabilizing core behavior.

5. [component-map.md](./component-map.md)
   Component map and stage-to-component relationships.

6. [deployment-model.md](./deployment-model.md)
   Current local execution and target enterprise/cloud deployment patterns.

7. [scalability-plan.md](./scalability-plan.md)
   `TARGET ARCHITECTURE` for worker scaling and distributed processing.

8. [technology-stack.md](./technology-stack.md)
   Verified current stack separated from target technology options.

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

## Target system control model

The full four-stage model below is `TARGET ARCHITECTURE`. The current core executes discovery and static analysis through `LegacyExodusEngine`; it does not execute ZelvoxForge or VymosGate.

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

The future execution architecture must preserve:

**Untrusted Legacy Code → Isolated Intake → Parser → Knowledge Model → Governed AI Gateway**

The current core applies repository path and projection containment but does not provide a general execution sandbox or AI gateway. Those controls must not be described as current until implemented and verified.

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
