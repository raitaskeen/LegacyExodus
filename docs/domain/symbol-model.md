# Symbol Model & Semantic Resolution Invariants

## Overview

The **Symbol Model** defines the extraction, identity, and semantic resolution contracts for code symbols within LegacyExodus. Symbols serve as the foundational entities connecting syntax analysis (AST) to relational graphs (Dependency Graph, Call Graph, CFG, DFG) and downstream architecture reasoning.

---

## 1. Symbol Extraction Architecture

Symbol extraction is performed by AST extractors (such as `JavaScriptSymbolExtractor`) operating over validated AST representations.

### Core Symbol Properties
- **ID (`id`)**: Deterministic SHA-256 hash computed from file path, symbol kind, lexical scope, container identity, and declaration name.
- **Name (`name`)**: The unqualified identifier name of the symbol.
- **Kind (`kind`)**: The structural type (`function`, `class`, `method`, `variable`, `import`, `export`, `parameter`).
- **Scope ID (`scopeId`)**: Unique lexical scope identifier representing the enclosing block or function scope.
- **Container Name (`containerName`)**: The object or prototype container on which member symbols are attached (e.g. `app` for `app.init = ...`, `proto` for `proto.handle = ...`, `res` for `res.send = ...`).
- **Container ID (`containerId`)**: The resolved symbol ID of the enclosing class declaration for class members.

---

## 2. Semantic Call Resolution Contract

Call resolution is performed by `DeterministicCallGraphBuilder` within the semantic analysis engine. Call resolution follows an evidence-bound, conservative resolution pipeline:

```text
                                CALL EXPRESSION
                                (receiver.method)
                                       │
                ┌──────────────────────┴──────────────────────┐
                │                                             │
         receiver === "this"                          receiver !== "this"
                │                                             │
      ┌─────────┴─────────┐                         ┌─────────┴─────────┐
      │                   │                         │                   │
Class Context      Prototype Method           Exact Container     Different / Unknown
  (classId)     (symbol.containerName)     (container === recv)        Container
      │                   │                         │                   │
   RESOLVE             RESOLVE                   RESOLVE           UNRESOLVED
                                                                   (No Guessing)
```

### Resolution Rules

1. **Direct Identifier Calls (`foo()`):**
   - Resolved by searching upwards through the enclosing lexical `ScopeFrame` hierarchy (`scope.parent`).
   - Resolves to the nearest declared function or class in scope.
   - If no enclosing declaration exists, remains `UNRESOLVED`.

2. **Class Instance Method Calls (`const r = new Router(); r.handle()`):**
   - Resolved via constructor evidence tracked in `ResolutionContext.receiverTypes`.
   - Matches methods whose `containerId === classId`.

3. **Explicit Named Receiver Calls (`app.init()`, `req.get()`, `res.send()`, `proto.handle()`):**
   - Strictly matches symbols declared on that exact container: `symbol.containerName === receiver`.
   - **Isolation Invariant**: Distinct receiver names never cross-match. Calling `req.send()` will never resolve to `res.send`. Calling `app.init()` will never resolve to `proto.init()`.

4. **Contextual `this` Receiver Calls (`this.defaultConfiguration()`):**
   - When called within class methods: resolves via class `containerId`.
   - When called within prototype/object definitions: resolves to declared prototype methods in the same file matching `symbol.containerName !== undefined`.

5. **Dynamic / Ambiguous Calls (`obj[name]()`, multiple matching targets):**
   - When multiple candidates exist or the receiver is dynamic / shadowed without local declaration evidence, the call remains `UNRESOLVED`.
   - The engine never guesses or invents target edges.

---

## 3. Complexity & Performance Characteristics

- **Time Complexity**: $\mathcal{O}(S)$ per call site, where $S$ is the number of symbols in the active file's local symbol table.
- **Memory Footprint**: $\mathcal{O}(C)$ temporary allocation for matched candidate references ($C \le 2$).
- **Isolation**: Local call resolution operates strictly over the active file's `SymbolTable` and does not scan unrelated files or re-parse ASTs.

---

## 4. Downstream Graph Integration

Resolved calls directly inform:
- **Call Graph (`SemanticCall`)**: Canonical `callerName` $\rightarrow$ `calleeName` $\rightarrow$ `targetSymbolId`.
- **Data Flow Graph (DFG)**: Interprocedural argument-to-parameter and return-to-variable propagation.
- **Taint Analysis**: Cross-function source-to-sink reachability paths.
