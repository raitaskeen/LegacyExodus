import type { ASTNode, ASTResult } from "@parser/index";
import type { CodeSymbol, SymbolTable } from "@symbols/index";
import { canonicalizePath } from "@graph/index";

/**
 * Phase C1 (audits/2026-11-10-blind-audit/PHASE-C-DESIGN.md): an object a repository factory builds and returns.
 *
 * `function fastify () { const fastify = { get: function _get () {}, inject: inject }; …; return fastify }` returns, on
 * every path, the one object literal bound to `fastify`. A call `app.get()` with `const app = fastify()` reaches that
 * literal's `get` when nothing replaces it. Each file contributes its factories while its AST and symbol table are at
 * hand; the index answers which function a factory's property names.
 *
 * Assumptions, stated in Current Implementation: a computed key or computed write (`fastify[kState] = …`) does not
 * produce a method's name, as for `this.m()`; reflection (`Object.defineProperty`, `Object.assign` onto the object) is
 * not followed. A property written by name anywhere in the factory's file, on any object, is left out, and a name some
 * other file writes on any object other than `this` and its own exports is never resolved through a factory.
 */
export interface FactoryFact {
  /** The factory's function symbol and every export of its file that names it. */
  readonly ids: readonly string[];
  /** Property name to the symbol of the function it holds. */
  readonly methods: readonly (readonly [string, string])[];
}

export interface FactoryFile {
  readonly filePath: string;
  readonly factories: readonly FactoryFact[];
}

const FUNCTION_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ObjectMethod", "ClassMethod", "ClassPrivateMethod"]);

function nameOf(node: ASTNode | undefined): string | undefined {
  return typeof node?.attributes.name === "string" ? node.attributes.name : undefined;
}

function role(node: ASTNode, name: string): ASTNode | undefined {
  return node.children.find((child) => child.role === name);
}

function startKey(location: { readonly start: { readonly line: number; readonly column: number } } | undefined): string | undefined {
  return location === undefined ? undefined : `${location.start.line}:${location.start.column}`;
}

/** Visits `node`'s subtree without entering nested functions (their returns and bindings are their own). */
function walkOwn(node: ASTNode, visit: (node: ASTNode) => void): void {
  visit(node);
  for (const child of node.children) if (!FUNCTION_TYPES.has(child.type)) walkOwn(child, visit);
}

function walkAll(node: ASTNode, visit: (node: ASTNode) => void): void {
  visit(node);
  for (const child of node.children) walkAll(child, visit);
}

/** A property key's name: an identifier, a string, or a computed string literal. A computed expression has none. */
function keyName(property: ASTNode): string | undefined {
  const key = role(property, "key");
  if (key === undefined) return undefined;
  if (property.attributes.computed === true) return key.type === "StringLiteral" && typeof key.attributes.value === "string" ? key.attributes.value : undefined;
  if (key.type === "StringLiteral" && typeof key.attributes.value === "string") return key.attributes.value;
  return nameOf(key);
}

/** One file's factories: functions whose every return gives the same local object literal binding. */
export function collectFactoryFacts(ast: ASTResult, table: SymbolTable | undefined): FactoryFile {
  const filePath = canonicalizePath(ast.metadata.sourcePath);
  const symbols = table?.symbols ?? [];
  const byStart = new Map<string, CodeSymbol[]>();
  const functionsByName = new Map<string, CodeSymbol[]>();
  for (const symbol of symbols) {
    const key = startKey(symbol.location);
    if (key !== undefined) byStart.set(key, [...(byStart.get(key) ?? []), symbol]);
    if (symbol.kind === "function") functionsByName.set(symbol.name, [...(functionsByName.get(symbol.name) ?? []), symbol]);
  }
  // Names the file writes by name on any object, `this` included: such a property may not hold its literal value.
  const writtenHere = new Set<string>();
  walkAll(ast.root, (node) => {
    if (node.type !== "AssignmentExpression") return;
    const left = role(node, "left");
    if ((left?.type === "MemberExpression" || left?.type === "OptionalMemberExpression") && left.attributes.computed !== true) {
      const name = nameOf(role(left, "property"));
      if (name !== undefined) writtenHere.add(name);
    }
  });

  const factories: FactoryFact[] = [];
  walkAll(ast.root, (node) => {
    if (node.type !== "FunctionDeclaration") return;
    const functionSymbol = (byStart.get(startKey(node.location) ?? "") ?? []).find((symbol) => symbol.kind === "function");
    const body = role(node, "body");
    if (functionSymbol === undefined || body === undefined) return;
    const returned = new Set<string>();
    let bareReturn = false;
    walkOwn(body, (inner) => {
      if (inner.type !== "ReturnStatement") return;
      const argument = role(inner, "argument");
      const name = argument?.type === "Identifier" ? nameOf(argument) : undefined;
      if (name === undefined) bareReturn = true;
      else returned.add(name);
    });
    if (bareReturn || returned.size !== 1) return;
    const objectName = [...returned][0]!;
    const declarators: ASTNode[] = [];
    walkOwn(body, (inner) => { if (inner.type === "VariableDeclarator" && nameOf(role(inner, "id")) === objectName) declarators.push(inner); });
    let reassigned = false;
    walkAll(body, (inner) => { if (inner.type === "AssignmentExpression" && nameOf(role(inner, "left")) === objectName) reassigned = true; });
    const literal = declarators.length === 1 ? role(declarators[0]!, "init") : undefined;
    if (reassigned || literal?.type !== "ObjectExpression") return;
    if (literal.children.some((child) => child.type === "SpreadElement")) return;

    const seen = new Map<string, number>();
    const methods = new Map<string, string>();
    for (const property of literal.children) {
      const name = keyName(property);
      if (name === undefined) continue;
      seen.set(name, (seen.get(name) ?? 0) + 1);
      let target: CodeSymbol | undefined;
      if (property.type === "ObjectMethod" && property.attributes.kind === "method") {
        target = (byStart.get(startKey(property.location) ?? "") ?? []).find((symbol) => symbol.name === name && (symbol.kind === "method" || symbol.kind === "function" || symbol.kind === "variable"));
      } else if (property.type === "ObjectProperty") {
        const value = role(property, "value");
        if (value?.type === "FunctionExpression" || value?.type === "ArrowFunctionExpression") {
          target = (byStart.get(startKey(property.location) ?? "") ?? []).find((symbol) => symbol.name === name && (symbol.kind === "variable" || symbol.kind === "method" || symbol.kind === "function"));
        } else if (value?.type === "Identifier") {
          const candidates = functionsByName.get(nameOf(value) ?? "") ?? [];
          target = candidates.length === 1 ? candidates[0] : undefined;
        }
      }
      if (target !== undefined) methods.set(name, target.id);
    }
    const kept = [...methods].filter(([name]) => seen.get(name) === 1 && !writtenHere.has(name)).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    if (kept.length === 0) return;
    const ids = [functionSymbol.id, ...symbols.filter((symbol) => symbol.kind === "export" && symbol.moduleSpecifier === undefined && symbol.sourceSymbolName === functionSymbol.name).map((symbol) => symbol.id)];
    factories.push({ ids: [...new Set(ids)].sort(), methods: kept });
  });
  return { filePath, factories };
}

/** The run's factories, looked up by the symbol a factory call resolves to. */
export class FactoryIndex {
  private readonly methodsById = new Map<string, ReadonlyMap<string, string>>();

  /** @param writtenElsewhere - whether some file writes a property of that name on an object other than `this`. */
  public constructor(files: Iterable<FactoryFile>, private readonly writtenElsewhere: (name: string) => boolean) {
    for (const file of files) {
      for (const factory of file.factories) {
        const methods = new Map(factory.methods);
        for (const id of factory.ids) this.methodsById.set(id, methods);
      }
    }
  }

  /** The function a factory's returned object holds at `name`, when the call resolved to `producerId`. */
  public methodOf(producerId: string, name: string): string | undefined {
    const target = this.methodsById.get(producerId)?.get(name);
    return target === undefined || this.writtenElsewhere(name) ? undefined : target;
  }
}
