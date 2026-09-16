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

## Purpose

- Parse supported JavaScript/TypeScript syntax deterministically.
- Produce normalized AST outputs with source locations.
- Preserve a contract boundary for future governed parser adapters.

## Architecture

```text
Discovery Artifact
      |
      v
Language Adapter
      |
      v
Parser Plugin
      |
      v
AST + Syntax Extraction
      |
      v
Source Mapper
      |
      v
Parsed Artifact
```

## Key Components

### Language Adapters
- Route files to correct parser plugin.
- Normalize parser runtime options.
- Handle encoding/newline/platform differences.

### Parser Plugins
- Implement language-specific parse logic.
- Emit schema-compliant AST/IR.
- Report diagnostics with file/line references.

### Source Mapper
- Preserve mapping from AST nodes to original source locations.
- Required for explainability, transformation lineage, and validation.

### Syntax Extraction
- Extract symbols, declarations, references, imports, signatures.
- Emit confidence/quality flags for ambiguous constructs.

## Contracts

### Input
- Discovery artifact + parser configuration profile.

### Output
- `ParsedArtifact`:
  - AST/IR fragments
  - symbol/index metadata
  - diagnostics
  - source maps
  - provenance hashes

## Plugin Model

- Parser plugins must declare:
  - language coverage
  - plugin version
  - input/output schema version
  - runtime permissions
- Non-compliant plugins are rejected at registration or invocation.

## Failure Handling

- Syntax errors: capture diagnostic, continue where policy allows.
- Parser crash/timeouts: isolate and retry if transient.
- Schema invalid output: hard fail for affected partition.

## Quality Metrics

- Parse success rate by language
- AST completeness
- Source-map coverage
- Diagnostic density and severity
