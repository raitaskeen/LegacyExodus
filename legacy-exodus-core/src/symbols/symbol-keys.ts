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
 * a redeclared `var`, a shadowing block binding) are numbered by `numberRepeats`: the first keeps the plain key.
 *
 * Positions are used only to find, within one revision, the node a scope id or symbol belongs to. They never
 * enter a key, so an edit that adds or removes lines elsewhere leaves every other key unchanged.
 */
export function assignSymbolKeys(symbols: readonly CodeSymbol[], root: ASTNode, path: string): readonly CodeSymbol[] {
  const tree = ownerTree(root, symbols);
  // Only the scopes symbols name are resolved, so nodes that open no named scope cost no strings.
  const wanted = new Set<number>();
  for (const symbol of symbols) {
    const at = symbol.scopeId === undefined ? undefined : scopePosition(symbol.scopeId);
    if (at !== undefined) wanted.add(at);
  }
  const byScopeId = scopeChains(root, tree, wanted);
  const draft = symbols.map((symbol) => `${path}#${chainFor(symbol, byScopeId, tree.byClassId)}${namePart(symbol)}:${symbol.kind}`);

  const order = symbols.map((_, index) => index).sort((left, right) => position(symbols[left]!) - position(symbols[right]!) || left - right);
  const keys = numberRepeats(draft, order);
  return symbols.map((symbol, index) => ({ ...symbol, key: keys[index]! }));
}

/**
 * Tells apart facts that would share a key (ADR-008). In `order` (default: as given), the first fact with each
 * base keeps the plain base; each later one gets `~1`, `~2`, …. Appending a repeat therefore leaves every existing
 * key unchanged; only a repeat inserted before an existing one shifts the ones after it.
 */
export function numberRepeats(bases: readonly string[], order: readonly number[] = bases.map((_, index) => index)): string[] {
  const keys = [...bases];
  const seen = new Map<string, number>();
  for (const index of order) {
    const base = bases[index]!;
    const ordinal = seen.get(base) ?? 0;
    seen.set(base, ordinal + 1);
    if (ordinal > 0) keys[index] = `${base}~${ordinal}`;
  }
  return keys;
}

interface OwnerTree {
  /** Owner chain (with a trailing `/`) of each owner record, in source order. */
  readonly chains: readonly string[];
  /** The record index of each owner node. */
  readonly indexOf: ReadonlyMap<ASTNode, number>;
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
  private readonly tree: OwnerTree;
  private readonly owners: readonly OwnerRange[];
  /** Built on the first `scopeKey`: most keyers never resolve a scope id. */
  private byScopeId: ReadonlyMap<string, string> | undefined;
  /** Facts keyed so far, by key without the path prefix (the same in every key of this file). */
  private readonly counts = new Map<string, number>();

  public constructor(private readonly path: string, private readonly root: ASTNode, symbols: readonly CodeSymbol[]) {
    this.tree = ownerTree(root, symbols);
    this.owners = this.tree.owners;
  }

  public key(kind: string, subject: string, at: { readonly line: number; readonly column: number } | undefined): string {
    const base = `${at === undefined ? "" : this.chainAt(packed(at.line, at.column))}${kind}:${subject}`;
    const ordinal = this.counts.get(base) ?? 0;
    this.counts.set(base, ordinal + 1);
    return `${this.path}#${base}@${ordinal}`;
  }

  /** `<path>#<owners>` of the innermost owner containing `at`: the key of the code a graph or scope analyses. */
  /** `<path>#<owners>` of the code whose lexical scope `scopeId` names (as symbols record it). */
  public scopeKey(scopeId: string): string {
    this.byScopeId ??= scopeChains(this.root, this.tree);
    return `${this.path}#${this.byScopeId.get(scopeId) ?? ""}`;
  }

  public ownerKey(at: { readonly line: number; readonly column: number } | undefined): string {
    return `${this.path}#${at === undefined ? "" : this.chainAt(packed(at.line, at.column))}`;
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

function ownerTree(root: ASTNode, symbols: readonly CodeSymbol[]): OwnerTree {
  const named = new Map<number, CodeSymbol>();
  const classes = new Map<number, CodeSymbol>();
  for (const symbol of symbols) {
    if (symbol.location === undefined) continue;
    const point = packed(symbol.location.start.line, symbol.location.start.column);
    if ((symbol.kind === "function" || symbol.kind === "method") && !named.has(point)) named.set(point, symbol);
    if (symbol.kind === "class" && !classes.has(point)) classes.set(point, symbol);
  }

  // Phase 1: every owner in source order, with its raw segment and enclosing owner.
  interface OwnerRecord { readonly node: ASTNode; readonly segment: string; readonly parent: number; readonly depth: number; readonly classId?: string }
  const records: OwnerRecord[] = [];
  const indexOf = new Map<ASTNode, number>();
  const visit = (node: ASTNode, anonymous: Map<string, number>, enclosing: number): void => {
    let innerOwner = enclosing;
    let inner = anonymous;
    if (isOwner(node)) {
      const point = node.location === undefined ? undefined : packed(node.location.start.line, node.location.start.column);
      const declared = point === undefined ? undefined : CLASS_TYPES.has(node.type) ? classes.get(point) : named.get(point);
      records.push({
        node,
        segment: segment(node, declared, anonymous),
        parent: enclosing,
        depth: enclosing < 0 ? 0 : records[enclosing]!.depth + 1,
        ...(CLASS_TYPES.has(node.type) && declared !== undefined ? { classId: declared.id } : {}),
      });
      innerOwner = records.length - 1;
      indexOf.set(node, innerOwner);
      inner = new Map();
    }
    for (const child of node.children) visit(child, inner, innerOwner);
  };
  const topLevel = new Map<string, number>();
  for (const child of root.children) visit(child, topLevel, -1);

  // Phase 2, depth by depth so a parent's chain is final first: owners sharing a segment under the same parent
  // (a getter and its setter, same-named object methods) are numbered by `numberRepeats` in source order.
  const chains: string[] = new Array(records.length);
  const levels: number[][] = [];
  records.forEach((record, index) => (levels[record.depth] ??= []).push(index));
  for (const level of levels) {
    const bases = level.map((index) => `${records[index]!.parent < 0 ? "" : chains[records[index]!.parent]}${records[index]!.segment}`);
    numberRepeats(bases).forEach((chain, position) => { chains[level[position]!] = `${chain}/`; });
  }

  const byClassId = new Map<string, string>();
  const owners: OwnerRange[] = [];
  const rangeOf = new Map<number, number>();
  records.forEach((record, index) => {
    if (record.classId !== undefined) byClassId.set(record.classId, chains[index]!);
    const location = record.node.location;
    if (location === undefined) return;
    let parent = record.parent;
    while (parent >= 0 && !rangeOf.has(parent)) parent = records[parent]!.parent;
    owners.push({ start: packed(location.start.line, location.start.column), end: packed(location.end.line, location.end.column), chain: chains[index]!, parent: parent < 0 ? -1 : rangeOf.get(parent)! });
    rangeOf.set(index, owners.length - 1);
  });
  return { chains, indexOf, byClassId, owners };
}

function isOwner(node: ASTNode): boolean {
  return FUNCTION_TYPES.has(node.type) || CLASS_TYPES.has(node.type) || node.type === "TSModuleDeclaration" || node.type === "StaticBlock";
}

/**
 * The owner chain of the scope each scope id names: `scope:<type>:<line>:<column>` is the scope a node opens
 * (inside it, if it is an owner), `self:…` the scope a named function or class expression binds its own name
 * in, between it and its parent. With `wanted` (packed start positions), only nodes starting there are named.
 */
function scopeChains(root: ASTNode, tree: OwnerTree, wanted?: ReadonlySet<number>): ReadonlyMap<string, string> {
  const chainOf = (owner: number): string => owner < 0 ? "" : tree.chains[owner]!;
  const byScopeId = new Map<string, string>([["scope:module", ""]]);
  const visit = (node: ASTNode, enclosing: number): void => {
    const owner = tree.indexOf.get(node);
    const inner = owner ?? enclosing;
    const start = node.location?.start;
    if (start !== undefined && (wanted === undefined || wanted.has(packed(start.line, start.column)))) {
      const where = `${start.line}:${start.column}`;
      if (owner !== undefined) byScopeId.set(`self:${node.type}:${where}`, chainOf(enclosing));
      byScopeId.set(`scope:${node.type}:${where}`, chainOf(inner));
    }
    for (const child of node.children) visit(child, inner);
  };
  for (const child of root.children) visit(child, -1);
  return byScopeId;
}

/** The packed start position a positional scope id (`<prefix>:<type>:<line>:<column>`) names. */
function scopePosition(scopeId: string): number | undefined {
  const column = scopeId.lastIndexOf(":");
  const line = scopeId.lastIndexOf(":", column - 1);
  if (line < 0) return undefined;
  const lineNumber = Number(scopeId.slice(line + 1, column));
  const columnNumber = Number(scopeId.slice(column + 1));
  return Number.isInteger(lineNumber) && Number.isInteger(columnNumber) ? packed(lineNumber, columnNumber) : undefined;
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

function chainFor(symbol: CodeSymbol, byScopeId: ReadonlyMap<string, string>, byClassId: ReadonlyMap<string, string>): string {
  // A class member is declared in the class body, whatever lexical scope it was recorded in.
  if (symbol.member === true && symbol.containerId !== undefined) {
    const owner = byClassId.get(symbol.containerId);
    if (owner !== undefined) return owner;
  }
  return symbol.scopeId === undefined ? "" : byScopeId.get(symbol.scopeId) ?? "";
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
