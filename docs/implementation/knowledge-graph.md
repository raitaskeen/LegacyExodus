# Knowledge Graph Implementation

This document describes the deterministic structural knowledge graph builder in `src/knowledge/`. It is not a business-rule graph, runtime behavior model, or migration plan.

---

## 1. Responsibilities & Data Model

The `DeterministicKnowledgeGraphBuilder` unifies disparate symbol tables and dependency graph edges into an immutable, queryable knowledge graph representation.

```mermaid
classDiagram
    class KnowledgeNode {
      +string id
      +KnowledgeNodeKind kind ("file" | "symbol")
      +string name
      +string filePath
    }

    class KnowledgeEdge {
      +string id
      +string from
      +string to
      +KnowledgeRelationship relationship ("contains" | "imports")
    }

    class KnowledgeGraph {
      +readonly KnowledgeNode[] nodes
      +readonly KnowledgeEdge[] edges
    }

    KnowledgeGraph --> KnowledgeNode
    KnowledgeGraph --> KnowledgeEdge
```

---

## 2. Invariants & Determinism

1. **Deterministic Edge Hashing:** Every edge ID is computed via SHA-256: `sha256("${from}:${relationship}:${to}")`.
2. **Deterministic Sort Order:** All emitted `nodes` and `edges` arrays are sorted lexicographically by `id`.
3. **Immutability:** Nodes, edges, their arrays, and the top-level `KnowledgeGraph` object are frozen by the contract builder.
4. **Zod Runtime Schema Validation:** Schema validation guarantees structural integrity before freezing.

---

## 3. Implementation Evidence

* **Source Location:** [`src/knowledge/knowledge-graph.ts`](../../legacy-exodus-core/src/knowledge/knowledge-graph.ts).
* **Tests:** `knowledge-graph.test.ts` (100% passing tests).
* **Architecture Spec:** **[Knowledge Service Architecture](../architecture/components/knowledge-service.md)**.
