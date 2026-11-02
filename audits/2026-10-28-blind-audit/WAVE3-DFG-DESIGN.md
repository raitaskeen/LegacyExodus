# Wave 3 design — data flow on the control-flow graph

Status: DESIGN (lead, 2026-11-02). Owner decision of 2026-10-28: rebuild the DFG on the CFG
instead of patching F-004 option B. Findings closed by this wave: BA-05 (F-004), BA-04, BA-06,
BA-27, BA-28; BA-07 (policy) follows as its own item. Gate inputs: the conformance ledger
groups for those findings, the F-004 runtime-oracle cases, fact-diff, and the scale benchmarks.

## Problem

`src/flow/data-flow-builder.ts` walks the AST in source order:
- Only `if` forks and joins scope maps.
- Loops, `switch`, `try`, `&&`/`||`/`??`/`?:` and logical assignment run as straight-line code. That causes 23 of 27 missed runtime flows (BA-05).
- A source passed directly to a sink or cross-file call is dropped (BA-04).
- The test of a conditional is treated as data (BA-06).
- Join bookkeeping lives in a module-global `WeakRef` map (BA-27).
- Every `if` copies the whole scope chain, which makes the stage superlinear (BA-28: 28.6 s for a 4k-line file; Ghost needs 10 GB in total).

Since F-003 and BA-14, the CFG is oracle-checked: per function scope, blocks of statements, with
`next/true/false/case/loop-back/break/continue/return/throw/exception/finally` edges, dominators
and natural loops, with exception edges per clause and `finally` copied per jump kind.

## Decisions

1. **One analysis per CFG.** Data flow runs per `ControlFlowGraph` (each function scope plus the module scope) as a forward worklist fixed point over blocks, reusing the CFG builder's blocks and edges. No second control model.
2. **Statement-to-AST access.** The CFG builder keeps an internal, non-persisted `Map<statementId, ASTNode>`, returned from a new `buildAllWithNodes(ast)`. `buildAll` stays as it is, so the CFG contract and fact-diff output are unchanged. Compound statements appear as header nodes in their block, and the transfer function evaluates only their own clause (`if` test, loop test/update/iterable, `switch` discriminant, `case` test). It never re-walks child statements, because those live in their own blocks.
3. **Abstract state.** Per binding, keep a set of reaching definitions, plus taint as `sourceId → {must}`.
   - May facts are a union at joins.
   - Must facts (CONFIRMED) are an intersection at joins: a flow is CONFIRMED only if the source reaches the sink on every path from the entry to the sink.
   - States are persistent maps (structural sharing) or copy-on-write per block, never a deep copy per statement.
   - The lattice is finite, so the fixed point terminates without widening.
4. **Expression-level control inside a statement.** `a && b`, `a || b`, `a ?? b`, `c ? x : y`, `a &&= b`, `a ||= b`, `a ??= b` and optional chains are evaluated structurally within the transfer function:
   - Fork the incoming state, evaluate each arm, then join (may = union, must = intersection).
   - The value of `c ? x : y` is the join of the `x` and `y` values. The test `c` produces uses only, never data (BA-06).
   - The graph keeps its existing `UNSUPPORTED` marking. Data flow no longer depends on it.
5. **Exceptions.**
   - An `exception` edge carries the join of the states before each potentially-throwing statement in the source block: union for may, intersection for must.
   - `catch` binds its parameter with no source.
   - `finally` copies are ordinary blocks.
6. **Closures.** A nested function's read of an outer binding sees every definition of that binding in the enclosing function: may facts only, never CONFIRMED. Writes from nested functions are recorded as definitions that reach the outer function's later reads as may facts.
7. **Sources at sinks and calls (BA-04).**
   - Sink records keep `argumentSourceIds` beside `argumentDefinitionIds`.
   - `CallFlowBinding` gains optional `argumentSourceIds`, so `flow-analysis-engine.connect()` carries direct sources across files.
   - The schema change is additive and optional.
8. **No module globals (BA-27).** Join and must information lives in the per-build state returned by `buildContext()`, and `computeTaintFlows` takes it explicitly.
9. **Output contract.**
   - `DataFlowGraph` keeps its schema and id formulas (`definition:file:name:kind:line:col`).
   - The synthetic `join` definitions emitted by the old `if` joining go away. Must and may are now computed directly, so a fact-diff will show them as lost `dfg` and `dfg-uses` facts. That is expected and is listed in the PR.
   - `functionSummaries` and `callBindings` keep their meaning.
10. **Policy unchanged here.** Sources, sinks and sanitizers stay the current built-in set. BA-07 (resolved-binding policy packs) is the next item.

## Rollout (one finding-sized PR each; same gate as every wave)

| Step | Change | Expected fact-diff | Closes |
|---|---|---|---|
| 3a | `buildAllWithNodes` plus the statement map; a new `cfg-dataflow.ts` with the worklist and lattice, built in parallel with the old builder, behind no switch; unit tests on the lattice and transfer functions only | 0/0 (not wired in) | — |
| 3b | `DeterministicDataFlowGraphBuilder.buildContext` delegates intra-procedural flow to 3a; interprocedural summaries keep their current shape | taint gains on F-004 cases; `join` definitions lost (explained) | BA-05, BA-06, BA-27 |
| 3c | `argumentSourceIds` on sinks and bindings; `connect()` carries them | taint gains; no losses | BA-04 |
| 3d | Scale gate: stage timer doubling ≤ 2.5×; Ghost pinned as a benchmark with time and memory budgets (with BA-17 streaming if needed) | none | BA-28 |

**As built (2026-11-03).** 3a merged as #220. 3b merged as #221 with a narrower seam than planned:
- The contract gives each use one `definitionId`, so the CFG engine decides **taint verdicts** only, for sources evaluated in the sink's own function.
- The legacy builder still emits definitions, uses, summaries, bindings and cross-call paths, so no `join` definitions were lost.
- A flow the CFG rules out is dropped only when its path stays inside one function.
- Closures follow decision 6. A function nothing references or exports counts as never running.
- 3b also closed BA-04 within a file (a direct source at a sink). 3c keeps the cross-file part.
- Because the old builder still runs alongside, BA-28 waits for 3d.

3c merged as #222 (cross-file direct sources). 3d merged as #223:
- Profiling found five superlinear causes, all fixed with byte-identical output: per-`if` frame copies, linear transfer dedupe, the sweep fixed point, quadratic function indexing, and cubic idom extraction.
- The gate holds at ≤ 2.5× per doubling of function count.
- Long single functions remain quadratic.
- Ghost is pinned with ceiling budgets; its first run is pending.

## Verification model

- **Ledger:** the BA-04, BA-05 and BA-06 groups in `tests/conformance/known-gaps.ts` must flip and be removed. That is 23 + 2 + 1 expectations plus the analyzed companions.
- **Runtime oracle:** every conformance taint case runs in `vm`.
  - A runtime flow implies an engine flow (soundness of may).
  - An engine CONFIRMED flow implies a runtime flow on the case's input.
- **Fuzz:** generated straight-line, branch, loop, switch and try programs with one source and one sink. The engine's may-set must contain every runtime-observed flow over several random inputs. A CONFIRMED flow must be observed on every run.
- **Determinism:** two runs give byte-identical `data-flow.json`.
- **Performance:**
  - The stage-timer doubling ratio is ≤ 2.5× at 1k → 2k → 4k functions; it is 5–15× today.
  - Ghost's peak RSS and wall time are recorded against today's 10.2 GB and 26 min, with a budget set after 3b.

## Non-goals

- Inter-procedural context sensitivity.
- Heap and object-field modelling beyond today's member paths.
- Taint policy redesign (BA-07).
- Any change to the CFG's persisted contract.
