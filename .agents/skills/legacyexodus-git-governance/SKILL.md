---
name: legacyexodus-git-governance
description: Repository branch rules, commit discipline, synchronization protocols, and clean-tree standards for LegacyExodus.
---

# Skill: LegacyExodus Git Governance

## 1. Purpose
This skill defines the mandatory Git branching policies, commit standards, remote synchronization workflows, and merge safety gates for the LegacyExodus repository. It prevents permanent branch sprawl, accidental force-pushes, and cross-branch state contamination.

## 2. Scope
Applies to all Git operations across all local and remote branches in `LegacyExodus`.

## 3. When to Use
* Creating new branches for engineering tasks, bug fixes, or documentation work.
* Staging, formatting, and committing code changes.
* Synchronizing local branches with remotes (`origin`).
* Preparing pull requests and auditing branch cleanliness.
* Verifying post-merge synchronization.

## 4. When NOT to Use
* Writing implementation code (use `legacyexodus-forensic-remediation`).
* Auditing code quality (use `legacyexodus-code-audit`).

## 5. Authoritative Branch Architecture
LegacyExodus maintains exactly **three permanent engineering branches**:

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                      PERMANENT BRANCH ARCHITECTURE                      │
├──────────────────┬──────────────────────────────────────────────────────┤
│ Branch           │ Responsibility & Scope                               │
├──────────────────┼──────────────────────────────────────────────────────┤
│ main             │ Canonical integration & release trunk. Authoritative.│
│ core-foundation  │ Implementation engineering trunk (legacy-exodus-core)│
│ docs-foundation  │ Architecture documentation & specification trunk     │
└──────────────────┴──────────────────────────────────────────────────────┘
```

### Temporary Task Branches
* All work MUST occur on temporary task branches.
* Standard prefixes:
  * `fix/<finding-id>`: Forensic bug remediations.
  * `feat/<feature-name>`: Verified new feature additions.
  * `chore/<maintenance-topic>`: Dependency, toolchain, or pipeline updates.
  * `audit/<topic>`: Read-only investigative snapshots.
* **Deletion Invariant:** Temporary task branches MUST be deleted locally and remotely upon successful merge to prevent repository clutter.
* **Anti-Sprawl Invariant:** Contributors MUST NOT create permanent branches named `skills`, `skill.md`, `agent-governance`, or any variation thereof.

---

## 6. Operating Procedure

### Step 1: Pre-Flight Remote Synchronization
Before starting any new work or creating a branch:
```bash
git fetch --all --prune
git status
```
* Verify working tree cleanliness. Stash or discard uncommitted scratch work before switching branches.

### Step 2: Branch Creation
Always branch from the authoritative base branch (`main` or `core-foundation`):
```bash
git checkout -b <type>/<task-name> main
git rev-parse HEAD
```

### Step 3: Staging & Hygiene Audit
Before committing:
1. Check modified files: `git status`.
2. Check diff contents: `git diff`.
3. Verify no trailing whitespace or diff corruption:
   ```bash
   git diff --check
   ```
4. Stage strictly the intended files:
   ```bash
   git add <target-file-1> <target-file-2>
   ```

### Step 4: Conventional Commit Discipline
Commits MUST follow the Conventional Commits specification:
```text
<type>(<scope>): <concise imperative summary>

- Detailed bullet point 1
- Detailed bullet point 2

Co-authored-by: rsexo <raitaskeen.dev@gmail.com>
Co-authored-by: pamexo <raimrazzaq12@gmail.com>
```
* **Types:** `fix`, `feat`, `chore`, `docs`, `perf`, `test`, `refactor`.
* **Scopes:** `discovery`, `parser`, `symbols`, `graph`, `semantic`, `flow`, `storage`, `runtime`, `cli`, `governance`, `toolchain`.

### Step 5: Push Verification
Push only to the dedicated temporary task branch on origin:
```bash
git push origin <type>/<task-name>
```
* Verify that `git status` reports `nothing to commit, working tree clean`.

---

## 7. Prohibited Behavior (Strict Invariants)
1. **NEVER Commit Directly to `main`:** All changes must land on `main` via verified Pull Requests.
2. **NEVER Force-Push Shared Branches:** Force-pushing (`git push --force`) to `main`, `core-foundation`, or `docs-foundation` is prohibited.
3. **NEVER Merge `main` into `docs-foundation` Merely to Sync Core:** The stale `legacy-exodus-core` directory inside `docs-foundation` must remain untouched. Documentation agents must query core via `git show core-foundation:<path>`.
4. **NEVER Copy Core Files into `docs-foundation`:** Avoid duplicating codebase trees across branches.
5. **NEVER Commit Secrets or Credentials:** Any file containing an API token, private key, or password must be aborted and cleaned.
