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

## Current purpose

- Inspect a caller-supplied local repository without rewriting source files.
- Deterministically inventory files, classify known languages and artifact kinds, hash repository-relative paths, and record enumeration failures.
- Parse the root `package.json` when present to collect production/development dependency signals and supported framework heuristics.
- Produce validated discovery records and derived `.discovery` artifacts.

## Core Responsibilities

1. Local repository-path intake
2. File scanning and classification
3. Extension/path-based language and artifact-kind classification
4. Root `package.json` dependency and framework-signal extraction
5. Discovery artifact packaging for parser/graph services  

## Internal Pipeline

### 1) Repository Intake
- Resolve a user-supplied local repository path.
- Record deterministic project and file metadata.
- Reject a non-directory project path and skip symbolic-link entries during traversal.

### 2) File Scanner
- Enumerate files/directories with filtering rules.
- Classify known source, configuration, manifest, documentation, markup, stylesheet, data, schema, container, binary, and unknown files.
- Build file inventory index.

### 3) Language Detector
- Classify supported source and inventoried artifact types using current extension/path rules and manifests.
- Inventory multi-language repositories while parsing only supported JS/TS inputs.

### 4) Dependency Extractor
- Parse the root `package.json` when it is present and valid.
- Record typed manifest read, parse, or validation degradation instead of treating malformed metadata as a clean absence.
- Leave source-level dependency resolution to later parser/symbol/graph stages.

### 5) Discovery Result
- Emit an immutable `ProjectDiscovery` containing project identity/path, file inventory, dependency and framework signals, languages, enumeration failures, manifest failures, and the discovery timestamp.

## Contracts

### Input
- Repository source reference + execution context.

### Output
- Validated `ProjectDiscovery` and `FileArtifact` contracts.
- Run-scoped storage records and derived projection artifacts produced by the storage/projection boundary.

## Failure Handling

- An invalid root path fails with a typed discovery error.
- Directory-read and entry-stat failures are retained as deterministic enumeration diagnostics so a partial inventory is not presented as complete.
- Root-manifest read, parse, and schema failures are retained as typed manifest diagnostics.

## Target architecture

Remote cloning, archive intake/quarantine, content-signature language detection, confidence scoring, broader manifest/lockfile interpretation, and governed multi-language parser dispatch are future capabilities. They are not current discovery behavior.

## Target observability

- Scan duration and classification distribution
- Language-detection confidence and dependency-extraction coverage
- Warning/error category metrics
