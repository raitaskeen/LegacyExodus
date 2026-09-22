# Parser Service

> **Status:** `PARTIAL`. The current core provides a parser contract, registry, manager, and one Babel-based adapter for supported JavaScript/TypeScript/JSX/TSX syntax. Multi-language adapters, dynamically loaded parser packages, parser sandboxing, canonical IR, timeout isolation, and complete source-map/provenance coverage are `TARGET ARCHITECTURE` or `NOT IMPLEMENTED`.

## Overview

Parser Service transforms discovered source artifacts into normalized structural representations for graph and knowledge construction.

## Scope

- normalized AST generation for supported JS/TS syntax
- parser contracts, registry, and manager
- one Babel language adapter
- source-location preservation where exposed by current contracts
- downstream symbol extraction

## Current purpose

- Parse supported JavaScript/TypeScript syntax deterministically.
- Produce normalized AST outputs with source locations.
- Preserve a contract boundary for future governed parser adapters.
- Accept standard JavaScript/TypeScript decorator syntax while retaining decorator nodes as syntax only; decorator semantics are not interpreted.

## Architecture

```text
Discovery Artifact
      |
      v
Parser Manager + Registry
      |
      v
Babel JavaScript Adapter
      |
      v
Normalized AST Result
      |
      v
Downstream Symbol Extraction
```

## Key Components

### Parser manager and registry
- Select the first registered parser that supports the requested language.
- Reject missing, duplicate, or invalid parser registrations/results with typed errors.

### Parser adapters
- Implement language-specific parse logic behind the common `Parser` contract.
- Emit validated normalized AST results with parser metadata, statistics, warnings, and errors.
- The current runtime registers one in-process Babel-based JavaScript parser; package loading and sandboxed parser plugins are not implemented.

### Source locations
- Preserve Babel source locations on normalized nodes when the adapter exposes them.
- Complete source-map and provenance coverage is not implemented.

### Downstream symbol extraction
- Symbol extraction consumes the validated normalized AST after parsing.
- Ambiguous semantic relationships are handled conservatively by downstream symbol/graph/semantic stages.

## Contracts

### Input
- `ParseRequest` containing language, source path, and source text.

### Output
- `ParseResponse` containing a validated immutable `ASTResult`.
- `ASTResult` contains parser/language/source-path metadata, one normalized AST root, parser statistics, warnings, and errors.

## Target plugin model

- Future governed parser plugins would need to declare:
  - language coverage
  - plugin version
  - input/output schema version
  - runtime permissions
- Permission declarations and out-of-process enforcement are not implemented.

## Failure Handling

- Syntax/parser errors are isolated per file and surfaced through deterministic parser-failure reporting while the supported analysis run continues.
- Unsupported source languages remain unsupported; there is no fallback acquisition or dynamic plugin download.
- Parser timeouts and automatic transient retries are not implemented.
- Schema-invalid parser output is rejected by the parser boundary.

## Target quality metrics

- Parse success rate by language
- AST completeness
- Source-map coverage
- Diagnostic density and severity
