# Symbol Model & Semantic Resolution Invariants

## Overview

The **Symbol Model** defines the extraction, identity, and semantic resolution contracts for code symbols within LegacyExodus. Symbols serve as the foundational entities connecting syntax analysis (AST) to relational graphs (Dependency Graph, Call Graph, CFG, DFG) and downstream architecture reasoning.

---

## 1. Symbol Extraction Architecture

Symbol extraction is performed by AST extractors (such as `JavaScriptSymbolExtractor`) operating over validated AST representations.

### Core Symbol Properties
- **ID (`id`)**: Deterministic SHA-256 hash computed from the extractor's sourcePath, symbol kind, declaration name, and source position: `SHA-256(${sourcePath}:${kind}:${name}:${position})` (where `position` represents source line and column coordinates, or a deterministic anonymous sequence index for unlocated nodes). Contextual attributes such as `scopeId`, `containerName`, and `containerId` are attached metadata rather than identity hash inputs.
- **Name (`name`)**: The unqualified identifier name of the symbol.
- **Kind (`kind`)**: The structural symbol kind defined by `SymbolKind` (`"class" | "export" | "function" | "import" | "method" | "variable"`).
- **Declaration Kind (`declarationKind`)**: The declaration form for variables and parameters (`"const" | "let" | "var" | "param"`). Formal parameters are modeled as `kind: "variable"` with `declarationKind: "param"`; enclosing callable symbols additionally preserve ordered parameter names in `parameters: readonly string[]`.
- **Scope ID (`scopeId`)**: Unique lexical scope identifier representing the enclosing block or function scope (`scope:module`, `scope:block:...`).
- **Container Name (`containerName`)**: The object or prototype container on which member symbols are attached (e.g. `app` for `app.init = ...`, `proto` for `proto.handle = ...`, `res` for `res.send = ...`).
- **Container ID (`containerId`)**: The resolved symbol ID of the enclosing class declaration for class members.

---

## 2. Semantic Call Resolution Contract

Call resolution is performed by `DeterministicCallGraphBuilder` within the semantic analysis engine. Call resolution follows an evidence-bound, conservative resolution pipeline:

```text
                                  CALL EXPRESSION
                                         │
                 [Invocation Unwrapping: .call() / .apply() / .bind()]
                                         │
        ┌────────────────────────────────┴────────────────────────────────┐
        │                                                                 │
  Direct Identifier Call                                          Member Expression Call
         (foo())                                                     (receiver.method)
        │                                                                 │
  Check Lexical Shadowing                                                 │
        │                                                                 │
 ┌──────┴────────────────────────┐                      ┌─────────────────┴─────────────────┐
 │                               │                      │                                   │
Unshadowed Import       Enclosing Scope Chain    receiver === "this"                 receiver !== "this"
(!isShadowed &&           (nearestScoped via            │                                   │
 firstImportByName)      FileSymbolIndex)      ┌────────┴────────┐             ┌────────────┼────────────┐
 │                               │             │                 │             │            │            │
RESOLVE                       ┌──┴──┐     Class Context   Prototype Method  Typed Instance Named      Namespace Import
(targetByImportId)            │     │       (classId)    (containerMatches) (receiverType) Container (resolveNamespace)
                           In Scope Not in     │                 │             │            │            │
                              │     Scope   RESOLVE           RESOLVE       RESOLVE      RESOLVE      RESOLVE
                           RESOLVE  │                                          └───┬────────┼────────────┘
                                    ▼                                              │        ▼
                               UNRESOLVED                                          └► Otherwise UNRESOLVED
                                                                                          (No Guessing)
```

### Resolution Rules

1. **Direct Identifier Calls (`foo()`):**
   - **Imported Binding Path**: When an applicable unshadowed import binding exists for the identifier (`FileSymbolIndex.firstImportByName`), resolution uses that import evidence directly (`targetByImportId.get(imported.id)`). If the import has no resolved target in the dependency graph, the call remains `UNRESOLVED` without falling back to local lexical search.
   - **Lexical Scope Traversal Path**: When no applicable unshadowed import binding controls the identifier, resolution searches upward through the active lexical `ScopeFrame` hierarchy (`scope.parent`) via `FileSymbolIndex.byScopeAndName`, resolving to the nearest declared function or class in scope. If no matching enclosing declaration exists (or non-callable symbols shadow the name), the call remains `UNRESOLVED`.

2. **Class Instance Method Calls (`const r = new Router(); r.handle()`):**
   - Resolved via constructor evidence tracked in `ResolutionContext.receiverTypes`.
   - Matches methods whose `containerId === classId`.

3. **Explicit Named Receiver Calls (`app.init()`, `req.get()`, `res.send()`, `proto.handle()`):**
   - Strictly matches symbols declared on that exact container: `symbol.containerName === receiver`.
   - **Isolation Invariant**: Distinct receiver names never cross-match. Calling `req.send()` will never resolve to `res.send`. Calling `app.init()` will never resolve to `proto.init()`.

4. **Contextual `this` Receiver Calls (`this.defaultConfiguration()`):**
   - When called within class methods: resolves via class `containerId`.
   - When called within prototype/object definitions: resolves to declared prototype methods in the same file matching `symbol.containerName !== undefined` via `containerMatches()`.

5. **Imported Namespace Receiver Calls (`import * as api from "./api"; api.ping()`):**
   - When a method call is made on a receiver bound to an unshadowed namespace import (`importSymbol.sourceSymbolName === "*"`), the engine executes `resolveNamespaceCall`.
   - The import target module is canonically resolved using `ModuleResolver`.
   - The engine searches the target module's pre-extracted `SymbolTable` from `tablesByPath` for a matching exported symbol.
   - Unlike purely local resolution, namespace calls legitimately cross module boundaries via module resolution without re-parsing ASTs.

6. **Invocation Unwrapping (`.call()`, `.apply()`, and `.bind()`):**
   - **`.call(...)` and `.apply(...)`**: Direct function invocations executed immediately. Unwrapped by the semantic engine to resolve directly to the underlying function/method target symbol.
   - **`.bind(...)` Invocations**: When a bound function is immediately invoked (e.g. `fn.bind(...)()`, `obj.method.bind(...)()`, `this.method.bind(...)()`, chained `fn.bind(...).bind(...)()`, or via `.call()`/`.apply()`), the engine unwraps the bound callee chain and resolves the call edge directly to the underlying target function or method symbol, without emitting duplicate `.bind` call edges.
   - **Non-Invoked `.bind(...)`**: Value-producing operation creating a bound function value without executing the target function at that site (e.g. `const bound = fn.bind(...)`). The engine does **not** emit an invocation call edge to the underlying target function.

7. **Ambiguity and Candidate Selection:**
   - Local candidate-selection routes (such as lexical scope matching, class instance method lookup, and explicit named receiver matching) require a unique matching candidate (`candidates.length === 1`).
   - Ambiguous local candidate sets are never guessed or resolved heuristically. If an intermediate candidate-selection route fails uniqueness or finds no match, resolution continues to subsequent evidence routes in the dispatch pipeline.
   - Import and namespace routes follow their own deterministic lookup contracts (e.g. mapping via `firstImportByName` and direct export lookup via `ModuleResolver`).
   - If no applicable resolution route produces a resolved target, the call remains `UNRESOLVED`.

### Resolution Limitations & Boundary Invariants

- **Computed Member Expressions**:
  - *Supported*: Computed property keys with statically knowable values—including string literals (`obj["ping"]()`), expression-free template literals (``obj[`ping`]()``), and identifiers referencing in-scope constant bindings (`const KEY = "ping"; obj[KEY]()`)—are resolved via `resolvePropertyKey`.
  - *Unsupported*: When a computed property key uses a genuinely dynamic expression (such as variable expressions without static constant bindings, runtime arguments, or complex expressions like `obj[expr]()`), the callee name cannot be statically derived (`callName` yields `undefined`). Consequently, no outer `SemanticCall` record is emitted for that invocation.
- **Call-Result-Based Invocation Forms**:
  - Invocations evaluated on the result of an unnested call expression (such as `factory()()` or `getObject().method()`) do not yield a static callee or member name through `memberName`. Therefore, no outer `SemanticCall` record is emitted for the outer call, though inner nameable invocations (such as `getObject()`) are recorded independently.
  - This limitation is strictly distinct from supported invocation unwrapping for immediately invoked `.bind()`, `.call()`, and `.apply()` callee chains.
- **Emission vs. Unresolved Target Distinction**:
  - An invocation where a callee name is successfully extracted but no matching target can be uniquely proven emits a `SemanticCall` with `resolutionState: "UNRESOLVED"` and `targetSymbolId: undefined`.
  - An invocation where the callee or property name cannot be statically derived (such as dynamic computed properties or unnameable call-result receivers) emits no outer `SemanticCall` record.
- **Receiver Evidence Scope**:
  - A receiver requiring type-based resolution cannot be resolved by that route when no constructor/assignment evidence is available (`new Cls()`). However, calls on that receiver may still resolve if another explicit route applies (such as exact named container matching or namespace import resolution).
- **Cross-Module Prototype Chains**:
  - Transitive prototype inheritance across external module boundaries (beyond explicit local container naming and namespace imports) is unsupported in current resolution.
- **Current Capability Boundary**:
  - Arbitrary dynamic computed member resolution and whole-program cross-module prototype inheritance are currently unsupported by the static analysis engine.

---

## 3. Complexity & Performance Characteristics

Resolution is indexed rather than an unconditional full active-file symbol scan, but exact lookup cost depends on the resolution route:

- **Index Construction**:
  - $\mathcal{O}(S)$ one-time setup per file for $S$ symbols in the active file's `SymbolTable`, populating `FileSymbolIndex` maps (`byScopeAndName`, `byName`, `firstImportByName`, `classByLocation`).
- **Direct Lexical Identifier Lookup**:
  - Traversing the active lexical `ScopeFrame` hierarchy checks up to $D$ scope depth levels, performing $\mathcal{O}(1)$ map lookups in `byScopeAndName` and filtering candidates in the matching scope bucket.
- **Receiver / Method Name Lookup**:
  - Retrieves candidate symbols from the name-indexed bucket (`byName.get(methodName)`) in $\mathcal{O}(1)$ time, followed by candidate filtering against container and class criteria proportional to the bucket size $K$.
- **Namespace & Module Resolution**:
  - Namespace calls additionally incur canonical module specifier resolution via `ModuleResolver` and lookup against the target module's pre-extracted `SymbolTable` in `tablesByPath`.
- **Memory Footprint**:
  - Transient array allocations during candidate filtering are bounded by the number of candidate symbols sharing the target name within the indexed bucket. No artificial fixed constant bound ($C \le 2$) is enforced or guaranteed.
- **Module Boundaries & Isolation**:
  - Intra-file call resolution operates strictly over the active file's indexed `FileSymbolIndex`.
  - Inter-file namespace calls (`import * as ns from "./api"`) resolve across module boundaries by querying the target module's pre-extracted `SymbolTable` via `ModuleResolver` and repository-wide `tablesByPath`.
  - AST re-parsing is never performed during call resolution; all resolution operates over existing pre-extracted symbol tables.

---

## 4. Downstream Graph Integration

Resolved calls directly inform:
- **Call Graph (`SemanticCall`)**: Canonical `callerName` $\rightarrow$ `calleeName` $\rightarrow$ `targetSymbolId`.
- **Data Flow Graph (DFG)**: Interprocedural argument-to-parameter and return-to-variable propagation.
- **Taint Analysis**: Cross-function source-to-sink reachability paths.
