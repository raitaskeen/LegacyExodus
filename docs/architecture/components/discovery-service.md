# Discovery Service (VyrixScout)

> **Status:** `VERIFIED` for repository-local inventory, file classification, package dependency signals, framework heuristics, hashing, failure isolation, and deterministic discovery artifacts. Remote cloning, archive quarantine, syntax-signature language detection, confidence scoring, inferred source dependencies, and multi-language parsing are not current discovery capabilities.

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

1. Repository-path intake and manifest generation
2. File scanning and classification  
3. Language and framework detection  
4. Package-manifest dependency extraction
5. Discovery artifact packaging for parser/graph services  

## Internal Pipeline

### 1) Repository Intake
- Resolve a user-supplied local repository path.
- Record deterministic project and file metadata.
- Enforce owned-path and symlink boundaries used by current scanning/projection code.

### 2) File Scanner
- Enumerate files/directories with filtering rules.
- Identify binaries, generated files, vendored code.
- Build file inventory index.

### 3) Language Detector
- Classify supported source and inventoried artifact types using current extension/path rules and manifests.
- Inventory multi-language repositories while parsing only supported JS/TS inputs.

### 4) Dependency Extractor
- Parse lockfiles/manifests where available.
- Leave source-level dependency resolution to later parser/symbol/graph stages.

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
