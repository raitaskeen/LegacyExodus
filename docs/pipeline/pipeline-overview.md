# LegacyExodus Pipeline Status

This page separates current executable analysis from the target modernization pipeline.

## Current executable flow

```text
repository
  -> VyrixScout discovery
  -> Babel parse and normalized AST
  -> lexical symbols
  -> ESM/CommonJS module resolution
  -> dependency and knowledge graphs
  -> semantic calls/references/routes
  -> CFG, DFG, and conservative taint facts
  -> run-scoped memory or SQLite records
  -> validated .discovery projections
```

| Stage | State | What is true today |
|---|---|---|
| VyrixScout | `VERIFIED` | Deterministic inventory and classification for repository inputs |
| NolaraStruct | `PARTIAL` | Substantial JS/TS static analysis; not full runtime or business behavior |
| ZelvoxForge | `TARGET ARCHITECTURE` | No migration planner, rewriter, AI swarm, or Rust generator exists |
| VymosGate | `TARGET ARCHITECTURE` | No generated-code sandbox or equivalence certification exists |

## Current outputs

`analyze` may publish a manifest and available artifacts under `.discovery/`, including project/file/dependency/framework summaries and analysis artifacts such as symbols, graphs, semantic facts, and flow data. The manifest is the authoritative inventory for a specific projection; partial runs must not claim missing artifacts.

## Interpretation limits

- Static facts are conservative and may be unresolved.
- Taint facts do not constitute complete vulnerability detection.
- Sample fidelity results do not establish whole-repository migration safety.
- No stage currently transforms source or emits a modern target system.

See [Current Implementation](../CURRENT_IMPLEMENTATION.md) for the synchronized core boundary.
