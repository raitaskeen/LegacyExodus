import type { ASTNode } from "@parser/index";

/**
 * Resolves every identifier to the binding it names, for CFG data flow (Wave 3b). `var`,
 * parameters and a function expression's own name belong to the function; `let`, `const`, `class`
 * and function declarations to the nearest block (`for` heads, `catch` clauses and `switch` bodies
 * are blocks too). An undeclared name is a global. Assumes no `eval` or `with`.
 */
export interface LexicalBindings {
  /** Binding key of an identifier node. */
  readonly keyOf: ReadonlyMap<ASTNode, string>;
  /** The function (or Program) that declares each binding key. Globals have none. */
  readonly ownerOf: ReadonlyMap<string, ASTNode>;
}

interface Scope { readonly id: string; readonly parent?: Scope; readonly owner: ASTNode; readonly names: Set<string> }

const FUNCTION_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ObjectMethod", "ClassMethod", "ClassPrivateMethod"]);
const BLOCK_TYPES = new Set(["BlockStatement", "ForStatement", "ForInStatement", "ForOfStatement", "CatchClause", "SwitchStatement", "StaticBlock"]);

function role(node: ASTNode, name: string): ASTNode | undefined { return node.children.find((child) => child.role === name); }
function nameOf(node: ASTNode | undefined): string | undefined { const value = node?.attributes.name; return typeof value === "string" && value.length > 0 ? value : undefined; }

/** Identifiers a binding pattern declares. */
function patternNames(node: ASTNode | undefined, into: string[] = []): string[] {
  if (node === undefined) return into;
  switch (node.type) {
    case "Identifier": { const name = nameOf(node); if (name !== undefined) into.push(name); return into; }
    case "ObjectPattern": for (const property of node.children) patternNames(property.type === "ObjectProperty" ? role(property, "value") : property, into); return into;
    case "ArrayPattern": for (const element of node.children) patternNames(element, into); return into;
    case "RestElement": return patternNames(role(node, "argument"), into);
    case "AssignmentPattern": return patternNames(role(node, "left"), into);
    case "TSParameterProperty": return patternNames(role(node, "parameter"), into);
    default: return into;
  }
}

export function resolveLexicalBindings(root: ASTNode): LexicalBindings {
  const scopeOf = new Map<ASTNode, Scope>();
  let sequence = 0;
  const create = (node: ASTNode, parent: Scope | undefined, owner: ASTNode): Scope => {
    // No `#` in the id: binding keys append member paths after `#` (memberBindingKey).
    const scope = { id: `${node.type}@${node.location?.start.line ?? 0}:${node.location?.start.column ?? 0}~${sequence++}`, ...(parent === undefined ? {} : { parent }), owner, names: new Set<string>() };
    scopeOf.set(node, scope);
    return scope;
  };
  /** The scope of the function (or Program) enclosing `scope`: where `var` lands. */
  const functionScope = (scope: Scope): Scope => {
    let current = scope;
    while (current.parent !== undefined && scopeOf.get(current.owner) !== current) current = current.parent;
    return current;
  };

  // Pass 1: scopes and the names each declares.
  const declare = (node: ASTNode, scope: Scope): void => {
    let inner = scope;
    if (FUNCTION_TYPES.has(node.type)) {
      const name = nameOf(role(node, "id"));
      if (node.type === "FunctionDeclaration" && name !== undefined) scope.names.add(name);
      inner = create(node, scope, node);
      if (node.type === "FunctionExpression" && name !== undefined) inner.names.add(name);
      for (const parameter of node.children.filter((child) => child.role === "params")) for (const declared of patternNames(parameter)) inner.names.add(declared);
    } else if (node.type === "ClassDeclaration") {
      const name = nameOf(role(node, "id"));
      if (name !== undefined) scope.names.add(name);
    } else if (BLOCK_TYPES.has(node.type) && node !== root) {
      inner = create(node, scope, scope.owner);
      if (node.type === "CatchClause") for (const declared of patternNames(role(node, "param"))) inner.names.add(declared);
    } else if (node.type === "VariableDeclaration") {
      const target = node.attributes.kind === "var" ? functionScope(scope) : scope;
      for (const declarator of node.children.filter((child) => child.role === "declarations")) for (const declared of patternNames(role(declarator, "id"))) target.names.add(declared);
    } else if (node.type === "ImportDeclaration") {
      for (const specifier of node.children) { const local = nameOf(role(specifier, "local")); if (local !== undefined) scope.names.add(local); }
    }
    for (const child of node.children) declare(child, inner);
  };
  const program = create(root, undefined, root);
  for (const child of root.children) declare(child, program);

  // Pass 2: every identifier resolves through the scope it appears in.
  const keyOf = new Map<ASTNode, string>();
  const ownerOf = new Map<string, ASTNode>();
  const resolve = (name: string, scope: Scope): string => {
    for (let current: Scope | undefined = scope; current !== undefined; current = current.parent) {
      if (current.names.has(name)) {
        const key = `${current.id}:${name}`;
        ownerOf.set(key, current.owner);
        return key;
      }
    }
    return `global:${name}`;
  };
  const visit = (node: ASTNode, scope: Scope, parent: ASTNode | undefined): void => {
    // A declaration's own name is bound outside the function or class it names.
    const own = scopeOf.get(node);
    if (node.type === "Identifier") {
      const name = nameOf(node);
      const declaresOutside = parent !== undefined && node.role === "id" && (parent.type === "FunctionDeclaration" || parent.type === "ClassDeclaration");
      if (name !== undefined) keyOf.set(node, resolve(name, declaresOutside && scope.parent !== undefined && scopeOf.get(parent) === scope ? scope.parent : scope));
    }
    const inner = own ?? scope;
    for (const child of node.children) visit(child, inner, node);
  };
  for (const child of root.children) visit(child, program, root);
  return { keyOf, ownerOf };
}
