# Compiler Service (ZelvoxForge Core)

## Overview

Compiler Service is the transformation execution engine within ZelvoxForge. It converts governed transformation plans into buildable target code artifacts.

## Scope

- code generation
- Rust generation pipeline
- compilation
- validation hooks

## Purpose

- Generate deterministic modernization outputs from approved plans.
- Enforce transformation contracts and provenance.
- Integrate compile-time and pre-validation checks.

## Transformation Pipeline

```text
Approved Transformation Plan
          |
          v
Code Generation
          |
          v
Rust Generation Pipeline
          |
          v
Compilation
          |
          v
Validation Hooks
          |
          v
Transformation Bundle
```

## Core Responsibilities

1. Interpret transformation plan contracts.
2. Generate Rust + Axum + SQLx-aligned code artifacts.
3. Produce compilable project structures and manifests.
4. Execute compile checks and static validation hooks.
5. Emit provenance-linked transformation bundle.

## Rust Generation Pipeline

- Module scaffolding and domain segmentation
- API layer generation (Axum handlers/routes)
- Data layer generation (SQLx queries/models/migrations)
- Error-handling and observability instrumentation patterns
- Security baseline patterns (input validation, typed boundaries)

## Compilation Stage

- Deterministic build configuration
- Dependency resolution with pinned versions
- Compile diagnostics captured as structured output

## Validation Hooks (Pre-VymosGate)

- Schema conformance checks
- Lint/static checks
- Contract and source-mapping integrity checks
- Security pattern baseline checks

## Contracts

### Input
- Approved transformation plan + context snapshot.

### Output
- `TransformationBundle`:
  - generated source
  - compile results
  - diagnostics
  - provenance map
  - hook results

## Failure Handling

- Generation conflict => fail with actionable diagnostics.
- Compile failure => emit structured error set; no promotion.
- Provenance gap => hard fail and quarantine.

## Observability

- Generation duration
- Compile pass/fail by module
- Hook violation categories
- Bundle completeness metrics
