# Parser Service

## Overview

Parser Service transforms discovered source artifacts into normalized structural representations for graph and knowledge construction.

## Scope

- AST generation
- parser plugins
- language adapters
- source mapping
- syntax extraction

## Purpose

- Parse multi-language code safely and deterministically.
- Produce canonical AST/IR outputs with source traceability.
- Support extensibility via governed parser plugins.

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
