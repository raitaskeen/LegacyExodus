import type { ASTNode } from "@parser/index";

import type { CodeSymbol } from "./symbol-contracts";

/**
 * Edit-stable structural keys for symbols (ADR-008, step 1). A key names a symbol by what defines it,
 * never by where it is:
 *
 *   <path>#<owner>/<owner>/<name>:<kind>
 *
 * Owners are the enclosing classes, functions, methods and namespaces, each written `<name>:<kind>`; an
 * anonymous function or class is `<node type>@<n>`, numbered among the anonymous constructs of that type in
 * the same owner, in source order. Blocks add nothing. A class member hangs under its class; an object-literal
 * key or an `x.y =` member is named `<container>.<name>`. Symbols that would still share a key (overloads,
 * a redeclared `var`, a shadowing block binding) carry `~<n>` in source order.
 *
 * Positions are used only to find, within one revision, the node a scope id or symbol belongs to. They never
 * enter a key, so an edit that adds or removes lines elsewhere leaves every other key unchanged.
 */
export function assignSymbolKeys(symbols: readonly CodeSymbol[], root: ASTNode, path: string): readonly CodeSymbol[] {
  const chains = ownerChains(root, symbols);
  const draft = symbols.map((symbol) => `${path}#${chainFor(symbol, chains)}${namePart(symbol)}:${symbol.kind}`);

  const occurrences = new Map<string, number[]>();
  draft.forEach((key, index) => occurrences.set(key, [...(occurrences.get(key) ?? []), index]));
  const keys = [...draft];
  for (const [key, indexes] of occurrences) {
    if (indexes.length < 2) continue;
    const ordered = [...indexes].sort((left, right) => position(symbols[left]!) - position(symbols[right]!) || left - right);
    ordered.forEach((index, ordinal) => { keys[index] = `${key}~${ordinal}`; });
  }
  return symbols.map((symbol, index) => ({ ...symbol, key: keys[index]! }));
}

interface Chains {
  /** Owner chain (with a trailing `/` when non-empty) of the scope each scope id names. */
  readonly byScopeId: ReadonlyMap<string, string>;
  /** Owner chain of the class each class symbol id declares, including the class itself. */
  readonly byClassId: ReadonlyMap<string, string>;
  /** Every located owner, in source order, with its chain and the index of the owner enclosing it. */
  readonly owners: readonly OwnerRange[];
}

interface OwnerRange { readonly start: number; readonly end: number; readonly chain: string; readonly parent: number }

/**
 * Keys for the facts inside bodies (ADR-008 step 2): `<path>#<owners>/<kind>:<subject>@<n>`, where the owners
 * are those of the innermost class, function or namespace containing the fact, and `n` counts facts of that
 * kind and subject in that owner, in the order they are keyed (source order). An edit renumbers only the
 * same-subject facts of the one owner it touches.
 */
export class FactKeyer {
  private readonly owners: readonly OwnerRange[];
  private readonly counts = new Map<string, number>();

  public constructor(private readonly path: string, root: ASTNode, symbols: readonly CodeSymbol[]) {
    this.owners = ownerChains(root, symbols).owners;
  }

  public key(kind: string, subject: string, at: { readonly line: number; readonly column: number } | undefined): string {
    const base = `${this.path}#${at === undefined ? "" : this.chainAt(packed(at.line, at.column))}${kind}:${subject}`;
    const ordinal = this.counts.get(base) ?? 0;
    this.counts.set(base, ordinal + 1);
    return `${base}@${ordinal}`;
  }

  /** The chain of the innermost owner whose range contains `point` ("" at module level). */
  private chainAt(point: number): string {
    let low = 0;
    let high = this.owners.length - 1;
    let candidate = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (this.owners[middle]!.start <= point) { candidate = middle; low = middle + 1; } else high = middle - 1;
    }
    for (let index = candidate; index >= 0; index = this.owners[index]!.parent) {
      if (this.owners[index]!.end >= point) return this.owners[index]!.chain;
    }
    return "";
  }
}

function packed(line: number, column: number): number { return line * 1_000_000 + column; }

const FUNCTION_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ClassMethod", "ClassPrivateMethod", "ObjectMethod", "TSDeclareFunction", "TSDeclareMethod"]);
const CLASS_TYPES = new Set(["ClassDeclaration", "ClassExpression"]);

function ownerChains(root: ASTNode, symbols: readonly CodeSymbol[]): Chains {
  const at = (symbol: CodeSymbol): string | undefined => symbol.location === undefined ? undefined : `${symbol.location.start.line}:${symbol.location.start.column}`;
  const named = new Map<string, CodeSymbol>();
  const classes = new Map<string, CodeSymbol>();
  for (const symbol of symbols) {
    const key = at(symbol);
    if (key === undefined) continue;
    if ((symbol.kind === "function" || symbol.kind === "method") && !named.has(key)) named.set(key, symbol);
    if (symbol.kind === "class" && !classes.has(key)) classes.set(key, symbol);
  }

  const byScopeId = new Map<string, string>([["scope:module", ""]]);
  const byClassId = new Map<string, string>();
  const owners: OwnerRange[] = [];
  const visit = (node: ASTNode, chain: string, anonymous: Map<string, number>, enclosing: number): void => {
    const where = node.location === undefined ? undefined : `${node.location.start.line}:${node.location.start.column}`;
    let own = chain;
    let inner = anonymous;
    let innerOwner = enclosing;
    if (FUNCTION_TYPES.has(node.type) || CLASS_TYPES.has(node.type) || node.type === "TSModuleDeclaration" || node.type === "StaticBlock") {
      own = `${chain}${segment(node, where === undefined ? undefined : CLASS_TYPES.has(node.type) ? classes.get(where) : named.get(where), anonymous)}/`;
      inner = new Map();
      if (node.location !== undefined) {
        owners.push({ start: packed(node.location.start.line, node.location.start.column), end: packed(node.location.end.line, node.location.end.column), chain: own, parent: enclosing });
        innerOwner = owners.length - 1;
      }
      if (CLASS_TYPES.has(node.type) && where !== undefined) {
        const declared = classes.get(where);
        if (declared !== undefined) byClassId.set(declared.id, own);
      }
      // A named function or class expression binds its own name in a scope between it and its parent.
      if (where !== undefined) byScopeId.set(`self:${node.type}:${where}`, chain);
    }
    if (where !== undefined) byScopeId.set(`scope:${node.type}:${where}`, own);
    for (const child of node.children) visit(child, own, inner, innerOwner);
  };
  const topLevel = new Map<string, number>();
  for (const child of root.children) visit(child, "", topLevel, -1);
  return { byScopeId, byClassId, owners };
}

function segment(node: ASTNode, symbol: CodeSymbol | undefined, anonymous: Map<string, number>): string {
  if (node.type === "TSModuleDeclaration") {
    const id = node.children.find((child) => child.role === "id");
    const name = node.attributes.kind === "global" ? "global" : id?.attributes.name ?? id?.attributes.value;
    if (typeof name === "string") return `${name}:namespace`;
  } else if (symbol !== undefined && !symbol.anonymous) {
    return `${symbol.name}:${symbol.kind}`;
  }
  const ordinal = anonymous.get(node.type) ?? 0;
  anonymous.set(node.type, ordinal + 1);
  return `${node.type}@${ordinal}`;
}

function chainFor(symbol: CodeSymbol, chains: Chains): string {
  // A class member is declared in the class body, whatever lexical scope it was recorded in.
  if (symbol.member === true && symbol.containerId !== undefined) {
    const owner = chains.byClassId.get(symbol.containerId);
    if (owner !== undefined) return owner;
  }
  return symbol.scopeId === undefined ? "" : chains.byScopeId.get(symbol.scopeId) ?? "";
}

function namePart(symbol: CodeSymbol): string {
  // Object-literal keys and `x.y =` members are read through their container, not bound in a scope.
  return symbol.member === true && symbol.containerId === undefined && symbol.containerName !== undefined
    ? `${symbol.containerName}.${symbol.name}`
    : symbol.name;
}

function position(symbol: CodeSymbol): number {
  return symbol.location === undefined ? Number.MAX_SAFE_INTEGER : symbol.location.start.line * 1_000_000 + symbol.location.start.column;
}
