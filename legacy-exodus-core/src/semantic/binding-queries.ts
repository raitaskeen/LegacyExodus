/** Queries over a file's bindings and writes that call resolution asks. */
import type { ASTNode } from "@parser/index";
import { type CodeSymbol } from "@symbols/index";
import { type ScopeFrame, bindingWriteKey, lexicalBindingKey } from "./scope-model";
import type { FileSymbolIndex, ResolutionContext } from "./call-graph-types";
import { mayBelongToOtherBlock, resolveLexicalBinding } from "./lexical-bindings";

/**
 * Frame that declares `name` as seen from `scope`. Undeclared (global) names have none:
 * any script can write them, so no value-derived target through them is proven. Neither
 * has a function or class expression's own name, nor a declaration the symbol table places
 * in the wrong scope: what such a name holds there is not modeled.
 */
export function declaredBindingFrame(index: FileSymbolIndex, name: string, scope: ScopeFrame): ScopeFrame | undefined {
  for (let current: ScopeFrame | undefined = scope; current !== undefined; current = current.parent) {
    if (current.selfName === name) return undefined;
    if (mayBelongToOtherBlock(index, current.id, name)) return undefined;
    if (index.writes.blockFunctionVars.has(bindingWriteKey(current.id, name))) return undefined;
    if ((index.declarationsByScopeAndName.get(lexicalBindingKey(current.id, name)) ?? []).length > 0) {
      return index.writes.unscopedBindings.has(bindingWriteKey(current.id, name)) ? undefined : current;
    }
  }
  return undefined;
}

export function isRebound(index: FileSymbolIndex, scopeId: string, name: string): boolean {
  return index.writes.reboundBindings.has(bindingWriteKey(scopeId, name));
}

export function bindingKey(scope: ScopeFrame, name: string): string {
  return `${scope.id}:${name}`;
}

/**
 * The import that `name` names at `scope`. The symbol table files every `require` as a module
 * import, even one inside a function, so the import counts only where it is the visible binding.
 */
export function visibleImport(index: FileSymbolIndex, name: string, scope: ScopeFrame): CodeSymbol | undefined {
  const imported = index.firstImportByName.get(name);
  if (imported === undefined) return undefined;
  // RT-L9: a sloppy block function of the same name replaces the binding when its block runs (Annex B):
  // `var express = require("./lib"); if (…) { function express() {…} }` calls the block function afterwards.
  for (let current: ScopeFrame | undefined = scope; current !== undefined; current = current.parent) {
    if (index.writes.blockFunctionVars.has(bindingWriteKey(current.id, name))) return undefined;
  }
  const binding = resolveLexicalBinding(index, name, scope);
  return binding.state === "ONE_BINDING" && binding.referenceTargets.some((target) => target.id === imported.id) ? imported : undefined;
}

/** Writes that may replace `propertyName`; dynamic and reflective writes cannot reach private names. */
export function propertyWriteCount(index: FileSymbolIndex, propertyName: string): number {
  const writes = index.writes.propertyWrites.get(propertyName) ?? 0;
  return index.writes.unknownPropertyWrites && !propertyName.startsWith("#") ? Number.POSITIVE_INFINITY : writes;
}

/** No declaration, parameter, import or inner binding of `name` is visible at the call. */
export function isUnboundName(index: FileSymbolIndex, name: string, context: ResolutionContext): boolean {
  return resolveLexicalBinding(index, name, context.scope).state === "NO_BINDING"
    && !isLexicallyShadowed(name, context, index)
    && visibleImport(index, name, context.scope) === undefined
    && (index.byName.get(name) ?? []).length === 0;
}

export function isLexicallyShadowed(name: string, context: ResolutionContext, index: FileSymbolIndex): boolean {
  for (let current: ScopeFrame | undefined = context.scope; current !== undefined; current = current.parent) {
    if (current.id === "scope:module") {
      break;
    }
    if (current.selfName === name || context.receiverTypes.has(receiverKey(current, name)) || mayBelongToOtherBlock(index, current.id, name)) {
      return true;
    }
    if (context.constantBindings.has(bindingKey(current, name))) {
      return true;
    }
    if ((index.byScopeAndName.get(lexicalBindingKey(current.id, name)) ?? []).length > 0) {
      return true;
    }
  }
  return false;
}

export function receiverKey(scope: ScopeFrame, name: string): string {
  return `${scope.id}:${name}`;
}

/**
 * Phase C1c: the value an initialiser gives its binding, through an assignment chain: `var app = module.exports =
 * express()` binds `app` to the call's result, as an assignment expression's value is its right-hand side.
 */
export function assignedValue(node: ASTNode | undefined): ASTNode | undefined {
  let value = node;
  for (let depth = 0; depth < 8 && value?.type === "AssignmentExpression" && value.attributes.operator === "="; depth++) {
    value = value.children.find((child) => child.role === "right");
  }
  return value;
}
