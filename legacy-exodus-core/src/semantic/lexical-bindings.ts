/** The per-file lexical binding index and its lookup. */
import type { ASTNode, ASTResult } from "@parser/index";
import type { SymbolTable } from "@symbols/index";
import { createLexicalScopeId, type CodeSymbol } from "@symbols/index";
import { compareCodePoints } from "@shared/ordering";
import { type ScopeFrame, createsScope, declarationAnchor, extractBoundNames, identifier, isCallable, lexicalBindingKey, nodeName } from "./scope-model";
import type { FileSymbolIndex, LexicalBinding, LexicalResolution } from "./call-graph-types";

/** Whether `name` is unbound in this reopened-namespace block but declared in another block of it. */
export function mayBelongToOtherBlock(index: FileSymbolIndex, scopeId: string, name: string): boolean {
  return index.reopened.get(scopeId)?.has(name) === true && (index.byScopeAndName.get(lexicalBindingKey(scopeId, name)) ?? []).length === 0;
}

// Match only the CommonJS initializer forms already recognized by the extractor.
export function commonJsInitializerSpecifier(node: ASTNode | undefined): string | undefined {
  if (node?.type === "MemberExpression") return commonJsInitializerSpecifier(node.children.find(child => child.role === "object"));
  if (node?.type !== "CallExpression") return undefined;
  const callee = node.children.find(child => child.role === "callee");
  const argument = node.children.find(child => child.role === "arguments");
  if (identifier(callee) !== "require" || argument?.type !== "StringLiteral") return undefined;
  const value = argument.attributes.value;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

// Associate existing records once per file. A shared name is never an association.
export function createLexicalBindingIndex(
  ast: ASTResult,
  table: SymbolTable | undefined,
  byAnchor: ReadonlyMap<string, readonly CodeSymbol[]>,
  byScopeAndName: ReadonlyMap<string, readonly CodeSymbol[]>,
): ReadonlyMap<string, LexicalResolution> {
  const bindings = new Map<string, LexicalBinding>();
  const nonbindings = new Set<string>();
  const companions = new Set<string>();
  const classified = new Set<string>();
  const ambiguous = new Set<string>();
  const commonJsImports = new Set(
    (table?.moduleReferences ?? []).filter(reference => reference.form === "commonjs-import").flatMap(reference => reference.importSymbolIds),
  );
  const anchored = (node: ASTNode): readonly CodeSymbol[] => {
    const anchor = declarationAnchor(node.location);
    return anchor === undefined ? [] : byAnchor.get(anchor) ?? [];
  };
  const declare = (symbol: CodeSymbol): void => {
    classified.add(symbol.id);
    bindings.set(symbol.id, { canonical: symbol, referenceTargets: [symbol] });
  };
  const addCompanions = (canonical: CodeSymbol, targets: readonly CodeSymbol[]): void => {
    for (const target of targets) {
      classified.add(target.id);
      companions.add(target.id);
    }
    bindings.set(canonical.id, {
      canonical,
      referenceTargets: [...new Map([canonical, ...targets].map(symbol => [symbol.id, symbol])).values()]
        .sort((left, right) => compareCodePoints(left.id, right.id)),
    });
  };
  const boundIdentifiers = (node: ASTNode): readonly ASTNode[] => {
    if (node.type === "Identifier") return [node];
    if (node.type === "AssignmentPattern") {
      const left = node.children.find(child => child.role === "left");
      return left === undefined ? [] : boundIdentifiers(left);
    }
    if (node.type === "ObjectProperty") {
      const value = node.children.find(child => child.role === "value");
      return value === undefined ? [] : boundIdentifiers(value);
    }
    if (["ObjectPattern", "ArrayPattern", "RestElement"].includes(node.type)) return node.children.flatMap(boundIdentifiers);
    return [];
  };
  const visit = (node: ASTNode, scopeId: string, functionScopeId: string, parent?: ASTNode): void => {
    const nestedScope = createsScope(node) ? createLexicalScopeId(node.type, node.location) : scopeId;
    // A namespace body and a class static block run as functions, so `var` declared in them belongs to them.
    const nestedFunctionScope = isCallable(node) || node.type === "TSModuleDeclaration" || node.type === "StaticBlock" ? nestedScope : functionScopeId;
    if (node.type === "FunctionDeclaration" || node.type === "TSDeclareFunction" || node.type === "ClassDeclaration") {
      const kind = node.type === "ClassDeclaration" ? "class" : "function";
      for (const symbol of anchored(node)) {
        if (symbol.kind === kind && symbol.name === nodeName(node) && symbol.scopeId === scopeId) declare(symbol);
      }
    }
    if (isCallable(node)) {
      for (const param of node.children.filter(child => child.role === "param" || child.role === "params")) {
        for (const id of boundIdentifiers(param)) {
          for (const symbol of anchored(id)) {
            if (symbol.kind === "variable" && symbol.declarationKind === "param"
              && symbol.name === identifier(id) && symbol.scopeId === nestedScope) declare(symbol);
          }
        }
      }
    }
    if (node.type === "CatchClause") {
      const param = node.children.find(child => child.role === "param");
      if (param !== undefined) {
        const names = new Set(extractBoundNames(param));
        for (const symbol of anchored(param)) {
          if (symbol.kind === "variable" && symbol.declarationKind === "let"
            && names.has(symbol.name) && symbol.scopeId === nestedScope) declare(symbol);
        }
      }
    }
    if (["ImportSpecifier", "ImportDefaultSpecifier", "ImportNamespaceSpecifier"].includes(node.type)) {
      const local = node.children.find(child => child.role === "local");
      for (const symbol of anchored(node)) {
        if (symbol.kind === "import" && symbol.name === identifier(local) && symbol.scopeId === "scope:module") declare(symbol);
      }
    }
    if (node.type === "TSImportEqualsDeclaration") {
      // `import x = require("m")` binds an import and `import A = NS.B` a variable alias.
      const name = identifier(node.children.find(child => child.role === "id"));
      for (const symbol of anchored(node)) {
        if (symbol.name === name && ((symbol.kind === "import" && symbol.scopeId === "scope:module") || (symbol.kind === "variable" && symbol.scopeId === scopeId))) declare(symbol);
      }
    }
    if (node.type === "VariableDeclarator" && parent?.type === "VariableDeclaration") {
      const declarationKind = parent.attributes.kind;
      const declarationScope = declarationKind === "var" ? functionScopeId : scopeId;
      const binding = node.children.find(child => child.role === "id");
      const init = node.children.find(child => child.role === "init");
      for (const name of extractBoundNames(binding)) {
        const variables = anchored(node).filter(symbol => symbol.kind === "variable" && symbol.name === name
          && symbol.declarationKind === declarationKind && symbol.scopeId === declarationScope);
        for (const symbol of variables) declare(symbol);
        const imports = anchored(node).filter(symbol => symbol.kind === "import" && symbol.name === name
          && symbol.scopeId === "scope:module" && commonJsImports.has(symbol.id) && symbol.moduleSpecifier === commonJsInitializerSpecifier(init));
        if (variables.length === 1) {
          const canonical = variables[0]!;
          const functions = init?.type === "FunctionExpression" || init?.type === "ArrowFunctionExpression"
            ? anchored(init).filter(symbol => symbol.kind === "function" && symbol.name === name && symbol.scopeId === declarationScope)
            : [];
          const classes = init?.type === "ClassExpression"
            // The class is the value of this binding, under its own name when it has one.
            ? anchored(init).filter(symbol => symbol.kind === "class")
            : [];
          if (functions.length <= 1 && classes.length <= 1 && imports.length <= 1) addCompanions(canonical, [...functions, ...classes, ...imports]);
          else ambiguous.add(canonical.id);
        } else if (variables.length === 0) {
          for (const symbol of imports) declare(symbol);
        }
      }
    }
    // Only matching record kinds can prove a member or implementation role.
    const propertyRole = ["ObjectProperty", "ClassProperty", "ClassPrivateProperty", "PropertyDefinition", "ClassAccessorProperty"].includes(node.type);
    const implementationRole = node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression";
    const classExpressionRole = node.type === "ClassExpression";
    const memberTarget = (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") && node.role === "left";
    const importOrigin = node.type === "AssignmentExpression" || node.type === "ImportDeclaration";
    if (propertyRole || implementationRole || classExpressionRole || memberTarget || importOrigin) {
      for (const symbol of anchored(node)) {
        const confirmed = ((propertyRole || memberTarget) && (symbol.kind === "variable" || symbol.kind === "method"))
          || (implementationRole && (symbol.kind === "function" || symbol.kind === "method"))
          || (classExpressionRole && symbol.kind === "class")
          || (importOrigin && symbol.kind === "import");
        if (confirmed && !classified.has(symbol.id)) nonbindings.add(symbol.id);
      }
    }
    for (const child of node.children) visit(child, nestedScope, nestedFunctionScope, node);
  };
  visit(ast.root, "scope:module", "scope:module");

  const result = new Map<string, LexicalResolution>();
  for (const [key, records] of byScopeAndName) {
    const groups = new Map<string, LexicalBinding>();
    let opaque = false;
    for (const symbol of records) {
      if (companions.has(symbol.id) || nonbindings.has(symbol.id) || !["class", "function", "import", "variable"].includes(symbol.kind)) continue;
      const binding = bindings.get(symbol.id);
      if (binding !== undefined) {
        groups.set(binding.canonical.id, binding);
        if (ambiguous.has(symbol.id)) opaque = true;
      }
      // Explicit imports supplied by partial callers retain the old lookup compatibility.
      else if (symbol.kind === "import") groups.set(symbol.id, { canonical: symbol, referenceTargets: [symbol] });
      else opaque = true;
    }
    const only = groups.values().next().value;
    result.set(key, opaque || groups.size > 1 ? { state: "BLOCKED_AMBIGUOUS" }
      : only === undefined ? { state: "NO_BINDING" }
      : { state: "ONE_BINDING", ...only });
  }
  return result;
}

export function resolveLexicalBinding(index: FileSymbolIndex, name: string, scope: ScopeFrame): LexicalResolution {
  for (let current: ScopeFrame | undefined = scope; current !== undefined; current = current.parent) {
    if (current.selfName === name) return { state: "NO_BINDING" };
    const resolution = index.lexicalBindings.get(lexicalBindingKey(current.id, name));
    if (resolution !== undefined && resolution.state !== "NO_BINDING") return resolution;
    if (mayBelongToOtherBlock(index, current.id, name)) return { state: "BLOCKED_AMBIGUOUS" };
  }
  return { state: "NO_BINDING" };
}
