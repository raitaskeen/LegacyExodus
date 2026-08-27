# Contributing to LegacyExodus

Thank you for contributing to LegacyExodus! To ensure deterministic reliability, architectural integrity, and professional release hygiene, please follow these guidelines.

---

## 1. Branch Taxonomy & Responsibility

LegacyExodus strictly partitions repository responsibilities across distinct branches:

* **`core-foundation`**: All core source code, parser adapters, semantic engines, storage layers, CLI commands, unit tests, benchmarks, and runtime code.
* **`docs-foundation`**: All architectural specifications, ADRs, user guides, benchmark records, and documentation changes.
* **`main`**: Integration and release branch. PRs from `core-foundation` and `docs-foundation` are merged into `main`. Do **not** commit directly to `main`.

---

## 2. Engineering Standard: One Finding, One PR

We adhere to a strict scoped engineering standard:
* **One Finding → One Fix → One Focused Regression Test → One PR.**
* Avoid combining multiple unrelated audit findings or refactors into a single PR.
* Every bug fix or security patch must include a dedicated regression test proving the invariant permanently.

---

## 3. Commit Discipline & Co-Authorship

Every commit must follow Conventional Commits:
```text
<type>(<scope>): <summary>

Co-authored-by: rsexo <raitaskeen.dev@gmail.com>
Co-authored-by: pamexo <raimrazzaq12@gmail.com>
```

Types: `fix`, `feat`, `test`, `docs`, `perf`, `refactor`, `chore`.

---

## 4. Local Development & Verification Gates

All contributions must pass the complete core verification suite before opening a PR:

```bash
# In legacy-exodus-core/
bun run typecheck        # Zero TypeScript compilation errors
bun test                 # Full test suite execution
bun run benchmark audit  # 10-point governance benchmark audit
git diff --check         # Zero whitespace or merge conflict artifacts
```

---

## 5. Pull Request Submission

1. Use the provided [PR Template](.github/PULL_REQUEST_TEMPLATE.md).
2. Fill out all sections: Summary, Scope, Implementation, Tests, Benchmark Impact, Security Impact, Documentation Impact, and Checklist.
3. Link the corresponding GitHub issue (e.g. `Closes #123`).
