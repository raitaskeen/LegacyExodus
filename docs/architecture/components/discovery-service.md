# Discovery Service (VyrixScout)

## Overview

Discovery Service (VyrixScout) is responsible for safe, structured intake of unknown legacy repositories and producing normalized discovery artifacts for downstream stages.

```text
Repository
    |
    v
File Scanner
    |
    v
Language Detector
    |
    v
Dependency Extractor
    |
    v
Discovery Artifact
```

## Purpose

- Safely inspect repository contents.
- Detect languages/frameworks/build systems.
- Extract dependency signals and structural metadata.
- Produce deterministic discovery artifacts with provenance.

## Core Responsibilities

1. Repository intake and manifest generation  
2. File scanning and classification  
3. Language and framework detection  
4. Dependency extraction (manifest + inferred)  
5. Discovery artifact packaging for parser/graph services  

## Internal Pipeline

### 1) Repository Intake
- Clone/load source into isolated workspace.
- Record source metadata (origin, commit, checksum).
- Enforce size/type and security pre-checks.

### 2) File Scanner
- Enumerate files/directories with filtering rules.
- Identify binaries, generated files, vendored code.
- Build file inventory index.

### 3) Language Detector
- Detect by extension, shebang, manifests, syntax signatures.
- Support multi-language repositories.
- Emit confidence per language/domain.

### 4) Dependency Extractor
- Parse lockfiles/manifests where available.
- Infer unresolved dependencies from source imports/includes.
- Tag dependency certainty (`declared`, `inferred`, `unknown`).

### 5) Discovery Artifact
- Emit immutable artifact bundle:
  - file inventory
  - language profile
  - dependency profile
  - discovery warnings
  - provenance metadata

## Contracts

### Input
- Repository source reference + execution context.

### Output
- `DiscoveryArtifact` (versioned schema) with:
  - `artifact_id`
  - `source_ref`
  - `file_index`
  - `language_profile`
  - `dependency_profile`
  - `warnings`
  - `provenance`

## Failure Handling

- Unsupported or unreadable repositories => fail with diagnostics.
- Excessive size or unsafe archive patterns => quarantine.
- Partial detection allowed only with explicit confidence markers.

## Observability

- Scan duration
- File count and classification distribution
- Language detection confidence
- Dependency extraction coverage
- Warning/error categories
