import type { ASTNode } from "@parser/index";

import { analyzeControlFlow, combineTaint, joinTaint, mayOnly, type ControlFlowDataFlow, type DataFlowContext, type Taint } from "./cfg-dataflow";
import type { ControlFlowGraphsWithNodes } from "./control-flow-builder";
import { resolveLexicalBindings } from "./lexical-bindings";

/**
 * Wave 3b: taint verdicts at sinks from CFG data flow, for every graph of one file.
 *
 * Closures follow WAVE3-DFG-DESIGN.md decision 6. A read of a binding another function writes, or of
 * a binding declared outside the reading function, also sees every value written to it anywhere in
 * the file, as may facts only. Those values are collected round by round until they stop growing.
 */
export interface SinkVerdict {
  /** Sources reaching the sink's arguments; must when on every path (joined over `finally` copies). */
  readonly taint: Taint;
  /** Sources evaluated in the sink's own function: for these the verdict is authoritative. */
  readonly scopeSourceIds: ReadonlySet<string>;
}

export interface CfgTaintHooks {
  sourceOf(node: ASTNode): string | undefined;
  /** Sink id of a call, if it is a sink. */
  sinkIdOf(call: ASTNode): string | undefined;
  callValue(call: ASTNode, callee: Taint, args: readonly Taint[]): Taint;
}

const MAX_ROUNDS = 1_000;

function sameHeld(left: ReadonlyMap<string, Taint>, right: ReadonlyMap<string, Taint>): boolean {
  if (left.size !== right.size) return false;
  for (const [binding, taint] of left) {
    const other = right.get(binding);
    if (other === undefined || other.size !== taint.size) return false;
    for (const sourceId of taint.keys()) if (!other.has(sourceId)) return false;
  }
  return true;
}

export function cfgSinkVerdicts(root: ASTNode, built: ControlFlowGraphsWithNodes, hooks: CfgTaintHooks): ReadonlyMap<string, SinkVerdict> {
  const bindings = resolveLexicalBindings(root);
  // A function declaration nothing references or exports never runs, so its writes reach nothing.
  const references = new Map<string, number>();
  for (const key of bindings.keyOf.values()) references.set(key, (references.get(key) ?? 0) + 1);
  const exported = new Set(root.children.flatMap((child) => child.type === "ExportNamedDeclaration" || child.type === "ExportDefaultDeclaration" ? child.children.filter((inner) => inner.role === "declaration") : []));
  const live = (graphRoot: ASTNode | undefined): boolean => {
    if (graphRoot?.type !== "FunctionDeclaration" || exported.has(graphRoot)) return true;
    const id = graphRoot.children.find((child) => child.role === "id");
    const key = id === undefined ? undefined : bindings.keyOf.get(id);
    return key === undefined || (references.get(key) ?? 0) > 1;
  };
  const writers = new Map<string, Set<ASTNode>>();
  let held = new Map<string, Taint>();
  let results: readonly ControlFlowDataFlow[] = [];
  for (let round = 0; ; round++) {
    if (round >= MAX_ROUNDS) throw new Error("Closure taint did not converge.");
    const next = new Map<string, Taint>();
    const roundWriters = new Map<string, Set<ASTNode>>();
    results = built.graphs.map((graph) => {
      const graphRoot = built.graphRoots.get(graph.id);
      const graphIsLive = live(graphRoot);
      const context: DataFlowContext = {
        definitionId: (node, binding) => `${binding}@${node.location?.start.line ?? 0}:${node.location?.start.column ?? 0}`,
        sourceOf: hooks.sourceOf,
        bindingOf: (node, name) => bindings.keyOf.get(node) ?? `global:${name}`,
        callValue: hooks.callValue,
        readTaint: (binding, taint) => {
          const elsewhere = held.get(binding);
          const key = binding.split("#", 1)[0] ?? binding;
          const writtenByOthers = [...(writers.get(binding) ?? [])].some((writer) => writer !== graphRoot);
          if (writtenByOthers) return mayOnly(elsewhere === undefined ? taint : combineTaint(taint, elsewhere));
          if (bindings.ownerOf.get(key) !== graphRoot && elsewhere !== undefined) return combineTaint(taint, elsewhere);
          return taint;
        },
        onAssign: (binding, taint) => {
          if (!graphIsLive) return;
          if (taint.size > 0) next.set(binding, combineTaint(next.get(binding) ?? new Map(), mayOnly(taint)));
          if (graphRoot === undefined) return;
          const set = roundWriters.get(binding) ?? new Set<ASTNode>();
          set.add(graphRoot);
          roundWriters.set(binding, set);
        },
      };
      return analyzeControlFlow(graph, built, context);
    });
    const writersStable = [...roundWriters].every(([binding, set]) => [...set].every((writer) => writers.get(binding)?.has(writer) === true));
    for (const [binding, set] of roundWriters) writers.set(binding, new Set([...(writers.get(binding) ?? []), ...set]));
    if (writersStable && sameHeld(held, next)) break;
    held = next;
  }

  const verdicts = new Map<string, { taint: Taint; scopeSourceIds: Set<string> }>();
  for (const result of results) {
    for (const call of result.calls) {
      const sinkId = hooks.sinkIdOf(call.node);
      if (sinkId === undefined) continue;
      let taint: Taint = new Map();
      for (const argument of call.argumentTaint) for (const entry of argument) taint = combineTaint(taint, new Map([[entry.sourceId, entry.must]]));
      const existing = verdicts.get(sinkId);
      // Each `finally` copy of a sink is another path to it.
      verdicts.set(sinkId, existing === undefined
        ? { taint, scopeSourceIds: new Set(result.sourceIds) }
        : { taint: joinTaint(existing.taint, taint), scopeSourceIds: new Set([...existing.scopeSourceIds, ...result.sourceIds]) });
    }
  }
  return verdicts;
}
