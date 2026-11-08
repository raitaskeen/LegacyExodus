## Summary

<!-- Brief 1-3 sentence description of what this PR accomplishes. -->

## Finding / Objective

<!-- If closing an audit finding (e.g. F-001) or tracked issue, identify it here. -->

## Scope

- **In Scope:**
- **Out of Scope:**

## What Changed

<!-- Detail the changes made, grouped by component. -->

## Regression & Test Coverage

<!-- Describe the focused regression test file and assertions. -->

## Benchmark & Performance Impact

<!-- Note benchmark audit results (passed/total checks and verdict) or memory measurements. -->

## Security Impact

<!-- Detail permissions, data handling, or secret considerations. -->

## Documentation Impact

- [ ] Documentation updated in the same PR when behavior changes
- [ ] No documentation changes required

<!-- REQUIRED: identify affected README/docs and the core SHA used as evidence, or explain why product truth is unchanged. -->

**Impact:** REQUIRED / NONE

**Evidence / reason:**

**Docs synchronized against main:** `<SHA or N/A>`

## Breaking Changes

- [ ] None (Backward-compatible)
- [ ] Yes (Explain migration path)

## Related Issue

<!-- e.g. Closes #123, Fixes #123, Refs #123 -->

## PR Checklist

- [ ] Typecheck passes (`bun run typecheck`)
- [ ] Full test suite passes (`bun test`)
- [ ] Benchmark audit passes (`bun run benchmark audit`)
- [ ] Whitespace / Git diff check clean (`git diff --check`)
- [ ] Required co-authors included in commit message
- [ ] Targets `main` from a temporary task branch
- [ ] Current, partial, planned, and target-architecture claims are explicitly distinguished
