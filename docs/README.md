# LegacyExodus Documentation

Documentation follows current implementation truth. Start with [Current Implementation](CURRENT_IMPLEMENTATION.md), which describes `main`.

## Read by purpose

- **Current product boundary:** [Current Implementation](CURRENT_IMPLEMENTATION.md)
- **System explanation:** [System Overview](architecture/system-overview.md)
- **Pipeline status:** [Pipeline Overview](pipeline/pipeline-overview.md)
- **Runtime implementation:** [Core Engine](implementation/core-engine.md)
- **CLI commands:** [CLI Command Reference](development/cli/commands.md)
- **Storage semantics:** [Storage Layer](implementation/storage-layer.md)
- **Parser semantics:** [Parser Strategy](implementation/parser-strategy.md)
- **Knowledge graph:** [Knowledge Graph](implementation/knowledge-graph.md)
- **Documentation navigation:** [Documentation Map](DOCUMENTATION_MAP.md)
- **Documentation policy:** [Documentation Rules](DOCUMENTATION_RULES.md)

## Status language

Every material capability claim must use one of:

- `IMPLEMENTED`: code exists and is integrated.
- `VERIFIED`: implemented and supported by current passing evidence.
- `PARTIAL`: useful implementation exists with material limitations.
- `EXPERIMENTAL`: implemented but not stable/default.
- `PLANNED`: an accepted or concrete plan without integrated code.
- `TARGET ARCHITECTURE`: long-term direction, not current functionality.
- `NOT IMPLEMENTED`: no working integrated implementation.

Architecture, product, research, and integration pages may describe future systems. Unless a page explicitly cites current core evidence and labels a feature `IMPLEMENTED` or `VERIFIED`, such descriptions are design direction, not a claim that the feature exists today.

## Truth precedence

```text
current core source
  -> current executable tests
  -> verified runtime behavior
  -> current contracts and CLI
  -> documentation
  -> roadmap and target architecture
```

The stale `legacy-exodus-core/` snapshot on the retired `docs-foundation` branch must not be used as implementation evidence. Documentation work reads `main`.
