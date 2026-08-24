# Coding Standards & Architectural Conventions

This document establishes the non-negotiable coding and architectural standards for the **LegacyExodus** codebase.

---

## 1. Strict TypeScript Standards

1. **Zero `any` Types:** The `any` type is strictly forbidden. Use `unknown` with runtime type narrowing or generic parameters.
2. **Explicit Return Types:** All exported functions, methods, and classes must declare explicit return types.
3. **Readonly by Default:** All interface properties and object arguments should be marked `readonly` to enforce immutability:
   ```typescript
   export interface FileRecord {
     readonly fileId: string;
     readonly relativePath: string;
     readonly sizeBytes: number;
   }
   ```
4. **No Type Assertions (`as`):** Avoid unsafe type assertions. Validate unverified boundary data using **Zod** schemas.

---

## 2. Runtime Validation & Schemas

1. **Boundary Validation:** Every input arriving from the CLI, filesystem, or configuration must be validated through a Zod schema before entering engine logic.
2. **Discriminated Unions:** Command and Event payloads must be discriminated on `type`:
   ```typescript
   export const commandSchema = z.discriminatedUnion("type", [
     z.object({ type: z.literal("InitializeProject"), ... }),
     z.object({ type: z.literal("AnalyzeProject"), ... }),
   ]);
   ```

---

## 3. Immutability & Pure Reducer Patterns

1. **Immutable State Transitions:** Never mutate existing state objects or symbol tables in place.
2. **Pure Reducers:** All state modifications occur inside pure reducers (`event-reducer.ts`) returning new object copies.

---

## 4. Deterministic Invariants

1. **Deterministic Ordering:** Any operation producing a list of files, symbols, imports, or graph edges must sort entries deterministically (e.g. by `FileId` or alphabetical POSIX path).
2. **Platform-Agnostic Paths:** All internal file paths must be POSIX-normalized (`path.replace(/\\/g, '/')`).
3. **No Non-Deterministic Inputs:** Never use wall-clock timestamps or random seeds inside core hashing functions. All identity hashes must be pure functions of relative paths and file content.

---

## 5. Fail-Closed Conservative Semantics

1. **Never Guess:** When static analysis cannot prove a relationship with certainty:
   * Dynamic property calls $\longrightarrow$ `UNRESOLVED`
   * External third-party packages $\longrightarrow$ `null` (out-of-boundary)
2. **Fidelity Integrity:** Never reclassify ungrounded engine predictions as false positives. Unmatched sample predictions must remain `UNVERIFIED_SCOPED`.

---

## Related Documentation

* **[Developer Guide](development-guide.md):** Engine development and extension.
* **[Testing Strategy](testing-strategy.md):** Test coverage and invariants.
* **[GOVERNANCE.md](../../GOVERNANCE.md):** Repository boundaries and Three-Universe model.
