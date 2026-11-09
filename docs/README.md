# LegacyExodus Documentation

Documentation follows implementation truth: it describes `main`, and it never claims a capability the code and tests do not show. Start with **[Current Implementation](CURRENT_IMPLEMENTATION.md)**.

<p align="center">
  <img src="assets/readme/status-board.svg" width="100%" alt="What works today, what is partial with documented limits, what is planned next and what is target architecture."/>
</p>

## Read by purpose

<table>
  <tr>
    <td width="33%" valign="top">
      <b>Know what exists</b><br/>
      <sub>
        <a href="CURRENT_IMPLEMENTATION.md">Current Implementation</a>: the capability boundary<br/>
        <a href="pipeline/pipeline-overview.md">Pipeline Overview</a>: stage by stage status<br/>
        <a href="../ROADMAP.md">Roadmap</a>: what is next
      </sub>
    </td>
    <td width="33%" valign="top">
      <b>Understand the design</b><br/>
      <sub>
        <a href="architecture/system-overview.md">System Overview</a><br/>
        <a href="adr/README.md">Decision Records</a>: ADR-001 to ADR-011<br/>
        <a href="GLOSSARY.md">Glossary</a>
      </sub>
    </td>
    <td width="33%" valign="top">
      <b>Work in the engine</b><br/>
      <sub>
        <a href="implementation/core-engine.md">Core Engine</a><br/>
        <a href="implementation/parser-strategy.md">Parser Strategy</a> ·
        <a href="implementation/storage-layer.md">Storage Layer</a><br/>
        <a href="implementation/knowledge-graph.md">Knowledge Graph</a>
      </sub>
    </td>
  </tr>
  <tr>
    <td valign="top">
      <b>Use the CLI</b><br/>
      <sub><a href="development/cli/commands.md">CLI Command Reference</a>: every command and flag</sub>
    </td>
    <td valign="top">
      <b>Write documentation</b><br/>
      <sub>
        <a href="DOCUMENTATION_RULES.md">Documentation Rules</a><br/>
        <a href="DOCUMENTATION_MAP.md">Documentation Map</a>: every page
      </sub>
    </td>
    <td valign="top">
      <b>Contribute safely</b><br/>
      <sub>
        <a href="../CONTRIBUTING.md">Contributing</a> ·
        <a href="../SECURITY.md">Security</a>
      </sub>
    </td>
  </tr>
</table>

## Status language

Every material capability claim uses exactly one of these labels.

| Label | Meaning |
|---|---|
| `VERIFIED` | Implemented and supported by current passing evidence |
| `IMPLEMENTED` | Code exists and is integrated |
| `PARTIAL` | Useful implementation with material, documented limits |
| `EXPERIMENTAL` | Implemented, but not stable or default |
| `PLANNED` | An accepted or concrete plan without integrated code |
| `TARGET ARCHITECTURE` | Long-term direction, not current functionality |
| `NOT IMPLEMENTED` | No working integrated implementation |

Architecture, product, research and integration pages may describe future systems. Unless a page cites current core evidence and labels a feature `IMPLEMENTED` or `VERIFIED`, it describes direction, not a feature that exists today.

## Truth precedence

When two sources disagree, the higher one wins:

```mermaid
flowchart TB
    A["Current core source"] --> B["Current executable tests"]
    B --> C["Verified runtime behaviour"]
    C --> D["Current contracts and CLI"]
    D --> E["Documentation"]
    E --> F["Roadmap and target architecture"]
    classDef top fill:#138a6a,color:#fff,stroke:#138a6a
    classDef mid fill:#ffe6d6,color:#16130f,stroke:#b24418
    classDef low fill:#ececea,color:#16130f,stroke:#a3a39f
    class A,B top
    class C,D,E mid
    class F low
```

The stale `legacy-exodus-core/` snapshot on the retired `docs-foundation` branch is not implementation evidence. Documentation work reads `main`.
