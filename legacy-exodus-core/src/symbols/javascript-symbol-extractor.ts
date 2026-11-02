import { createHash } from "node:crypto";

import { validateASTResult, type ASTNode, type ASTResult } from "@parser/index";

import type { SymbolExtractor } from "./symbol-extractor";
import { sourceAnchorSchema, type ModuleReference, type SourceAnchor } from "./module-reference-contracts";
import {
  validateSymbolTable,
  type CodeSymbol,
  type SymbolKind,
  type SymbolSummary,
  type SymbolTable,
  createLexicalScopeId,
  createSelfScopeId,
} from "./symbol-contracts";
import { UnsupportedSymbolLanguageError } from "./symbol-errors";

interface ExtractionContext {
  readonly exported: boolean;
  readonly defaultExport: boolean;
  readonly containerName?: string;
  readonly containerId?: string;
  readonly enclosingAssignedName?: string;
  readonly enclosingAssignedId?: string;
  readonly scopeId: string;
  readonly functionScopeId?: string;
  readonly scopeChain: readonly string[];
  /**
   * True while visiting the body of a namespace or module declaration. An `export` there exports the
   * member from that namespace or ambient module; it is never an export of the file itself.
   */
  readonly namespaceBody?: boolean;
  /** True inside `declare` code and declaration files, where a namespace body may export its members implicitly. */
  readonly ambient?: boolean;
}

interface PendingExportBinding {
  readonly name: string;
  readonly scopeChain: readonly string[];
}

const initialContext: ExtractionContext = Object.freeze({
  exported: false,
  defaultExport: false,
  scopeId: "scope:module",
  functionScopeId: "scope:module",
  scopeChain: Object.freeze(["scope:module"]),
});

const supportedLanguages = new Set(["javascript", "typescript"]);
const DECLARATION_FILE = /\.d\.[mc]?ts$/i;

/**
 * How strongly a declaration owns the export symbol of its name. TypeScript lets several declarations
 * (a function and a namespace, a value and a type, two interfaces) share one name, which is still one
 * export: the strongest declaration, then the earliest, keeps the export symbol.
 */
type ExportRank = 0 | 1 | 2;
/** Class, function implementation, variable: the declarations that had export symbols before BA-02. */
const VALUE_DECLARATION: ExportRank = 0;
/** Enum, namespace, import-equals, overload signature without an implementation. */
const MERGEABLE_DECLARATION: ExportRank = 1;
/** Interface, type alias: type-only. */
const TYPE_DECLARATION: ExportRank = 2;

export class JavaScriptSymbolExtractor implements SymbolExtractor {
  private unlocatedSequence = 0;
  private moduleReferences: ModuleReference[] = [];
  /** Ids of function symbols created from overload or ambient signatures (`TSDeclareFunction`). */
  private signatureIds = new Set<string>();
  /**
   * Rank of each export symbol created from a declaration (`export <declaration>`), by symbol id. An
   * `export { X }` specifier has no rank of its own: it takes the strongest rank of the local `X`.
   */
  private declaredExports = new Map<string, ExportRank | { readonly local: string }>();
  /** The binding an anonymous class expression is assigned to: `const X = class {}`, `X = class {}`, `{ X: class {} }`. */
  private classBindingNames = new WeakMap<ASTNode, string>();

  public extract(ast: ASTResult): SymbolTable {
    const validatedAst = validateASTResult(ast);

    if (!supportedLanguages.has(validatedAst.metadata.language)) {
      throw new UnsupportedSymbolLanguageError(validatedAst.metadata.language);
    }

    this.unlocatedSequence = 0;
    this.moduleReferences = [];
    this.signatureIds = new Set();
    this.declaredExports = new Map();
    const extracted: CodeSymbol[] = [];
    const pendingExports: PendingExportBinding[] = [];
    this.visit(validatedAst.root, validatedAst, initialContext, extracted, pendingExports);
    const symbols = this.mergeDeclarations(extracted);

    for (const pending of pendingExports) {
      this.markLocalSymbolAsExported(pending.name, symbols, pending.scopeChain);
    }

    return validateSymbolTable({
      filePath: validatedAst.metadata.sourcePath,
      language: validatedAst.metadata.language,
      symbols,
      summary: createSummary(symbols),
      moduleReferences: this.moduleReferences,
    });
  }

  /**
   * Collapses declarations that TypeScript merges into one entity so each is modelled once:
   * - overload signatures and their implementation are one function: the implementation owns the
   *   function symbol, or the first signature when the function has no implementation (ambient code);
   * - declarations sharing an exported name are one export: a value declaration owns the export symbol
   *   (so its identity is what it was before types had symbols), otherwise the strongest then earliest.
   * Order in the file never changes the result. Declaration symbols themselves are never merged.
   */
  private mergeDeclarations(symbols: readonly CodeSymbol[]): CodeSymbol[] {
    const dropped = new Set<string>();

    const implemented = new Set<string>();
    for (const symbol of symbols) {
      if (symbol.kind === "function" && !this.signatureIds.has(symbol.id)) implemented.add(`${symbol.scopeId}\u0000${symbol.name}`);
    }
    const signed = new Set<string>();
    for (const symbol of symbols) {
      if (!this.signatureIds.has(symbol.id)) continue;
      const key = `${symbol.scopeId}\u0000${symbol.name}`;
      if (implemented.has(key) || signed.has(key)) dropped.add(symbol.id);
      signed.add(key);
    }

    const localRank = new Map<string, ExportRank>();
    for (const symbol of symbols) {
      if (symbol.scopeId !== "scope:module") continue;
      const rank: ExportRank | undefined = symbol.kind === "class" || symbol.kind === "variable" || symbol.kind === "import" ? VALUE_DECLARATION
        : symbol.kind === "function" ? (this.signatureIds.has(symbol.id) ? MERGEABLE_DECLARATION : VALUE_DECLARATION)
        : symbol.kind === "enum" || symbol.kind === "namespace" ? MERGEABLE_DECLARATION
        : symbol.kind === "interface" || symbol.kind === "type-alias" ? TYPE_DECLARATION : undefined;
      if (rank !== undefined && rank < (localRank.get(symbol.name) ?? 3)) localRank.set(symbol.name, rank);
    }
    const rankOf = (id: string): ExportRank | undefined => {
      const declared = this.declaredExports.get(id);
      return typeof declared === "object" ? localRank.get(declared.local) ?? VALUE_DECLARATION : declared;
    };
    const strongest = new Map<string, ExportRank>();
    for (const symbol of symbols) {
      const rank = rankOf(symbol.id);
      if (rank !== undefined && rank < (strongest.get(symbol.name) ?? 3)) strongest.set(symbol.name, rank);
    }
    const kept = new Set<string>();
    for (const symbol of symbols) {
      const rank = rankOf(symbol.id);
      if (rank === undefined) continue;
      const winner = strongest.get(symbol.name)!;
      // Several value declarations of one name stay as they were; weaker ones yield, and a tie keeps the first.
      if (rank > winner || (winner > VALUE_DECLARATION && kept.has(symbol.name))) dropped.add(symbol.id);
      else kept.add(symbol.name);
    }

    return dropped.size === 0 ? [...symbols] : symbols.filter((symbol) => !dropped.has(symbol.id));
  }

  private visit(
    node: ASTNode,
    ast: ASTResult,
    context: ExtractionContext,
    symbols: CodeSymbol[],
    pendingExports: PendingExportBinding[],
  ): void {
    this.noteClassBinding(node);
    switch (node.type) {
      case "ExportNamedDeclaration":
        if (context.namespaceBody === true) {
          this.addNamespaceExport(node, ast, false, symbols, context, pendingExports);
          return;
        }
        this.addExportSymbol(node, ast, false, symbols, context, pendingExports);
        this.visitChildren(node, ast, { ...context, exported: true }, symbols, pendingExports);
        return;
      case "ExportDefaultDeclaration":
        if (context.namespaceBody === true) {
          this.addNamespaceExport(node, ast, true, symbols, context, pendingExports);
          return;
        }
        this.addExportSymbol(node, ast, true, symbols, context, pendingExports);
        this.visitChildren(node, ast, { ...context, exported: true, defaultExport: true }, symbols, pendingExports);
        return;
      case "ExportAllDeclaration":
        // `export * from` inside an ambient module re-exports from that module, not from this file.
        if (context.namespaceBody === true) return;
        symbols.push(this.createSymbol("export", "*", node, ast, { ...initialContext, exported: true, defaultExport: false }, {
          moduleSpecifier: findModuleSpecifier(node),
        }));
        return;
      case "ImportDeclaration":
        this.addImportSymbols(node, ast, symbols);
        return;
      case "TSImportEqualsDeclaration":
        this.addImportEqualsSymbols(node, ast, context, symbols);
        return;
      case "TSExportAssignment":
        this.addExportAssignment(node, ast, context, symbols, pendingExports);
        return;
      case "TSEnumDeclaration":
      case "TSInterfaceDeclaration":
      case "TSTypeAliasDeclaration": {
        const kind = node.type === "TSEnumDeclaration" ? "enum" : node.type === "TSInterfaceDeclaration" ? "interface" : "type-alias";
        const name = getName(node);
        if (name !== undefined) symbols.push(this.createSymbol(kind, name, node, ast, context));
        // Members are not symbols, but initializers and computed keys are still code to visit.
        this.visitChildren(node, ast, { ...context, exported: false, defaultExport: false }, symbols, pendingExports);
        return;
      }
      case "TSModuleDeclaration":
        this.addModuleDeclaration(node, ast, context, symbols, pendingExports);
        return;
      case "TSDeclareFunction": {
        // A signature without a body: it has no scope, parameter bindings or code to visit.
        const signature = this.addFunctionSymbol(node, ast, context, symbols);
        this.signatureIds.add(signature.id);
        return;
      }
      case "VariableDeclaration":
        this.addVariableSymbols(node, ast, context, symbols);
        break;
      case "SwitchStatement":
      case "BlockStatement": {
        const blockScopeId = createLexicalScopeId(node.type, node.location);
        this.visitChildren(node, ast, {
          ...context,
          scopeId: blockScopeId,
          scopeChain: [blockScopeId, ...context.scopeChain],
        }, symbols, pendingExports);
        return;
      }
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement": {
        const loopScopeId = createLexicalScopeId(node.type, node.location);
        this.visitChildren(node, ast, {
          ...context,
          scopeId: loopScopeId,
          scopeChain: [loopScopeId, ...context.scopeChain],
        }, symbols, pendingExports);
        return;
      }
      case "CatchClause": {
        const catchScopeId = createLexicalScopeId(node.type, node.location);
        const catchContext: ExtractionContext = {
          ...context,
          scopeId: catchScopeId,
          scopeChain: [catchScopeId, ...context.scopeChain],
        };
        const param = node.children.find((child) => child.role === "param");
        if (param !== undefined) {
          const boundNames = extractBoundNames(param);
          for (const name of boundNames) {
            symbols.push(
              this.createSymbol("variable", name, param, ast, catchContext, {
                declarationKind: "let",
              }),
            );
          }
        }
        this.visitChildren(node, ast, catchContext, symbols, pendingExports);
        return;
      }
      case "AssignmentExpression":
        this.processAssignment(node, ast, context, symbols, pendingExports);
        return;
      case "FunctionDeclaration": {
        const fnScopeId = createLexicalScopeId(node.type, node.location);
        const fnSymbol = this.addFunctionSymbol(node, ast, context, symbols);
        this.extractParameterSymbols(node, ast, fnScopeId, fnSymbol.name, fnSymbol.id, symbols);
        this.visitChildren(node, ast, {
          ...context,
          enclosingAssignedName: undefined,
          enclosingAssignedId: undefined,
          scopeId: fnScopeId,
          functionScopeId: fnScopeId,
          scopeChain: [fnScopeId, ...context.scopeChain],
        }, symbols, pendingExports);
        return;
      }
      case "FunctionExpression":
      case "ArrowFunctionExpression": {
        const fnScopeId = createLexicalScopeId(node.type, node.location);
        const matchingSymbol = symbols.find(
          (s) => (s.kind === "function" || s.kind === "method") &&
            s.location !== undefined &&
            node.location !== undefined &&
            s.location.start.line === node.location.start.line &&
            s.location.start.column === node.location.start.column,
        );
        const fnName = matchingSymbol?.name ?? getName(node) ?? context.enclosingAssignedName;
        const fnId = matchingSymbol?.id ?? context.enclosingAssignedId;
        this.extractParameterSymbols(node, ast, fnScopeId, fnName, fnId, symbols);
        this.visitChildren(node, ast, {
          ...context,
          enclosingAssignedName: undefined,
          enclosingAssignedId: undefined,
          scopeId: fnScopeId,
          functionScopeId: fnScopeId,
          scopeChain: [fnScopeId, ...context.scopeChain],
        }, symbols, pendingExports);
        return;
      }
      case "ClassDeclaration": {
        const className = getName(node) ?? "anonymous-class";
        const classSymbol = this.createSymbol("class", className, node, ast, context);
        symbols.push(classSymbol);
        this.visitChildren(node, ast, { ...context, containerName: className, containerId: classSymbol.id }, symbols, pendingExports);
        return;
      }
      case "ClassExpression": {
        const ownName = getName(node);
        const className = ownName ?? this.classBindingNames.get(node) ?? "anonymous-class";
        // A class expression's own name is bound only inside the class, not in the enclosing scope.
        const classContext = ownName === undefined ? context : { ...context, scopeId: createSelfScopeId(node.type, node.location) };
        const classSymbol = this.createSymbol("class", className, node, ast, classContext, { expression: true });
        symbols.push(classSymbol);
        this.visitChildren(node, ast, { ...context, containerName: className, containerId: classSymbol.id }, symbols, pendingExports);
        return;
      }
      case "StaticBlock": {
        // A static block runs as a function: its `var` declarations belong to it, not to the class's scope.
        const blockScopeId = createLexicalScopeId(node.type, node.location);
        this.visitChildren(node, ast, {
          ...context,
          enclosingAssignedName: undefined,
          enclosingAssignedId: undefined,
          scopeId: blockScopeId,
          functionScopeId: blockScopeId,
          scopeChain: [blockScopeId, ...context.scopeChain],
        }, symbols, pendingExports);
        return;
      }
      case "ClassMethod":
      case "ClassPrivateMethod": {
        const methodScopeId = createLexicalScopeId(node.type, node.location);
        const methodSymbol = this.addMethodSymbol(node, ast, context, symbols);
        this.extractParameterSymbols(node, ast, methodScopeId, methodSymbol.name, methodSymbol.id, symbols);
        this.visitChildren(node, ast, {
          ...context,
          scopeId: methodScopeId,
          functionScopeId: methodScopeId,
          scopeChain: [methodScopeId, ...context.scopeChain],
        }, symbols, pendingExports);
        return;
      }
      case "ObjectMethod": {
        const methodScopeId = createLexicalScopeId(node.type, node.location);
        const methodSymbol = this.addMethodSymbol(node, ast, context, symbols);
        this.extractParameterSymbols(node, ast, methodScopeId, methodSymbol.name, methodSymbol.id, symbols);
        this.visitChildren(node, ast, {
          ...context,
          scopeId: methodScopeId,
          functionScopeId: methodScopeId,
          scopeChain: [methodScopeId, ...context.scopeChain],
        }, symbols, pendingExports);
        return;
      }
      case "ClassProperty":
      case "ClassPrivateProperty":
      case "PropertyDefinition":
      case "ClassAccessorProperty": {
        this.addClassPropertySymbol(node, ast, context, symbols, pendingExports);
        return;
      }
      default:
        break;
    }

    this.visitChildren(node, ast, context, symbols, pendingExports);
  }

  /** Records the binding that names an anonymous class expression, before the expression is visited. */
  private noteClassBinding(node: ASTNode): void {
    let name: string | undefined;
    let value: ASTNode | undefined;
    if (node.type === "VariableDeclarator") {
      const binding = node.children.find((child) => child.role === "id");
      if (binding?.type === "Identifier") name = readIdentifierName(binding);
      value = node.children.find((child) => child.role === "init");
    } else if (node.type === "ObjectProperty" && node.attributes.computed !== true) {
      const key = node.children.find((child) => child.role === "key");
      if (key?.type === "Identifier" || key?.type === "StringLiteral") name = getName(node);
      value = node.children.find((child) => child.role === "value");
    }
    if (name !== undefined && value?.type === "ClassExpression") this.classBindingNames.set(value, name);
  }

  private visitChildren(
    node: ASTNode,
    ast: ASTResult,
    context: ExtractionContext,
    symbols: CodeSymbol[],
    pendingExports: PendingExportBinding[],
  ): void {
    for (const child of node.children) {
      this.visit(child, ast, context, symbols, pendingExports);
    }
  }

  private addImportSymbols(node: ASTNode, ast: ASTResult, symbols: CodeSymbol[]): void {
    const symbolStart = symbols.length;
    const moduleSpecifier = findStringLiteral(node) ?? "unknown-module";
    const specifiers = node.children.filter(
      (child) => child.role === "specifiers" && child.type.startsWith("Import"),
    );

    if (specifiers.length === 0) {
      symbols.push(this.createSymbol("import", moduleSpecifier, node, ast, initialContext, { moduleSpecifier }));
      this.addModuleReference(node, moduleSpecifier, "esm-side-effect", symbols.slice(symbolStart), "value");
      return;
    }

    for (const specifier of specifiers) {
      const localName = readStringAttribute(specifier, "localName")
        ?? readIdentifierName(specifier.children.find((child) => child.role === "local"))
        ?? getName(specifier)
        ?? moduleSpecifier;
      const importedName = specifier.type === "ImportDefaultSpecifier"
        ? undefined
        : specifier.type === "ImportNamespaceSpecifier"
          ? "*"
          : readStringAttribute(specifier, "importedName")
            ?? readIdentifierName(specifier.children.find((child) => child.role === "imported"))
            ?? localName;

      symbols.push(
        this.createSymbol("import", localName, specifier, ast, initialContext, {
          moduleSpecifier,
          ...(importedName === undefined ? {} : { sourceSymbolName: importedName }),
          defaultExport: specifier.type === "ImportDefaultSpecifier",
        }),
      );
    }
    const phases = specifiers.map((specifier) => specifier.attributes.importKind === "type" ? "type" : "value");
    const phase = node.attributes.importKind === "type" ? "type"
      : phases.every((value) => value === "type") ? "type"
      : phases.some((value) => value === "type") ? "mixed" : "value";
    this.addModuleReference(node, moduleSpecifier, "esm-binding", symbols.slice(symbolStart), phase);
  }

  private addModuleReference(
    node: ASTNode,
    moduleSpecifier: string,
    form: ModuleReference["form"],
    symbols: readonly CodeSymbol[],
    sourcePhase?: ModuleReference["sourcePhase"],
  ): void {
    const importSymbolIds = symbols.filter((symbol) => symbol.kind === "import").map((symbol) => symbol.id);
    if (importSymbolIds.length === 0) return;
    const offset = sourceAnchorSchema.safeParse({ kind: "offset", start: node.attributes.start, end: node.attributes.end });
    const location = sourceAnchorSchema.safeParse({ kind: "location", ...node.location });
    const sourceAnchor: SourceAnchor | undefined = offset.success ? offset.data : location.success ? location.data : undefined;
    this.moduleReferences.push({ moduleSpecifier, form, importSymbolIds,
      ...(sourceAnchor === undefined ? {} : { sourceAnchor }),
      ...(sourcePhase === undefined ? {} : { sourcePhase }),
    });
  }

  private addVariableSymbols(
    node: ASTNode,
    ast: ASTResult,
    context: ExtractionContext,
    symbols: CodeSymbol[],
  ): void {
    const declarationKind = readDeclarationKind(node);
    const varContext = declarationKind === "var"
      ? { ...context, scopeId: context.functionScopeId ?? "scope:module" }
      : context;

    for (const declarator of node.children.filter(
      (child) => child.role === "declarations" && child.type === "VariableDeclarator",
    )) {
      const binding = declarator.children.find((child) => child.role === "id");
      const name = getName(declarator);
      const initializer = declarator.children.find((child) => child.role === "init");
      const required = requireSpecifier(initializer);
      const symbolStart = symbols.length;

      if (binding?.type === "ObjectPattern" || binding?.type === "ArrayPattern") {
        if (required !== undefined) {
          if (binding.type === "ObjectPattern") {
            const properties = binding.children.filter((child) => child.type === "ObjectProperty");
            if (properties.length > 0) {
              for (const prop of properties) {
                const keyName = readIdentifierName(prop.children.find((child) => child.role === "key")) ?? identifierName(prop);
                const valName = readIdentifierName(prop.children.find((child) => child.role === "value")) ?? keyName;
                if (valName !== undefined) {
                  symbols.push(this.createSymbol("import", valName, declarator, ast, initialContext, {
                    moduleSpecifier: required,
                    sourceSymbolName: keyName ?? valName,
                    defaultExport: false,
                  }));
                }
              }
            } else {
              const importedNames = extractBoundNames(binding);
              for (const importedName of importedNames) {
                symbols.push(this.createSymbol("import", importedName, declarator, ast, initialContext, {
                  moduleSpecifier: required,
                  sourceSymbolName: importedName,
                  defaultExport: false,
                }));
              }
            }
          } else {
            const importedNames = extractBoundNames(binding);
            for (const importedName of importedNames) {
              symbols.push(this.createSymbol("import", importedName, declarator, ast, initialContext, {
                moduleSpecifier: required,
                sourceSymbolName: importedName,
                defaultExport: false,
              }));
            }
          }
        } else {
          const boundNames = extractBoundNames(binding);
          for (const bName of boundNames) {
            symbols.push(
              this.createSymbol("variable", bName, declarator, ast, varContext, {
                declarationKind,
              }),
            );
          }
        }
        if (required !== undefined) this.addModuleReference(declarator, required, "commonjs-import", symbols.slice(symbolStart));
        continue;
      }

      if (name !== undefined) {
        const value = readLiteralInitializer(declarator);
        symbols.push(
          this.createSymbol("variable", name, declarator, ast, varContext, {
            declarationKind,
            ...(value === undefined ? {} : { value }),
          }),
        );
        if (initializer !== undefined && isAssignedFunction(initializer)) {
          symbols.push(this.createSymbol("function", name, initializer, ast, varContext, {
            parameters: getParameters(initializer),
            anonymous: false,
          }));
        }
        if (initializer !== undefined && initializer.type === "ObjectExpression") {
          const properties = findObjectProperties(initializer);
          for (const prop of properties) {
            symbols.push(
              this.createSymbol("variable", prop.key, prop.node, ast, {
                ...varContext,
                containerName: name,
              }, {
                declarationKind,
              }),
            );
          }
        }
      }
      if (required !== undefined) {
        const importedNames = bindingNames(binding);
        for (const importedName of importedNames) {
          const property = requireProperty(initializer);
          symbols.push(this.createSymbol("import", importedName, declarator, ast, initialContext, {
            moduleSpecifier: required,
            sourceSymbolName: property,
            defaultExport: property === undefined,
          }));
        }
      }
      if (required !== undefined) this.addModuleReference(declarator, required, "commonjs-import", symbols.slice(symbolStart));
    }
  }

  private addFunctionSymbol(
    node: ASTNode,
    ast: ASTResult,
    context: ExtractionContext,
    symbols: CodeSymbol[],
  ): CodeSymbol {
    const name = getName(node) ?? "anonymous-function";
    const symbol = this.createSymbol("function", name, node, ast, context, { parameters: getParameters(node) });
    symbols.push(symbol);
    return symbol;
  }

  private addMethodSymbol(
    node: ASTNode,
    ast: ASTResult,
    context: ExtractionContext,
    symbols: CodeSymbol[],
  ): CodeSymbol {
    const name = getName(node) ?? "anonymous-method";
    const symbol = this.createSymbol("method", name, node, ast, context, { parameters: getParameters(node) });
    symbols.push(symbol);
    return symbol;
  }

  private extractParameterSymbols(
    fnNode: ASTNode,
    ast: ASTResult,
    scopeId: string,
    containerName: string | undefined,
    containerId: string | undefined,
    symbols: CodeSymbol[],
  ): void {
    const paramNodes = fnNode.children.filter((child) => child.role === "params" || child.role === "param");
    for (const paramNode of paramNodes) {
      const boundNodes = extractBoundIdentifierNodes(paramNode);
      for (const idNode of boundNodes) {
        const name = readIdentifierName(idNode);
        if (name === undefined) continue;
        symbols.push(
          this.createSymbol("variable", name, idNode, ast, {
            ...initialContext,
            scopeId,
            containerName,
            containerId,
            exported: false,
            defaultExport: false,
          }, {
            declarationKind: "param",
          }),
        );
      }
    }
  }

  private addClassPropertySymbol(
    node: ASTNode,
    ast: ASTResult,
    context: ExtractionContext,
    symbols: CodeSymbol[],
    pendingExports: PendingExportBinding[],
  ): void {
    if (node.attributes.computed === true) {
      this.visitChildren(node, ast, context, symbols, pendingExports);
      return;
    }

    const name = getName(node);
    if (name === undefined) {
      this.visitChildren(node, ast, context, symbols, pendingExports);
      return;
    }

    const initializer = node.children.find((child) => child.role === "value" || child.role === "init");

    if (initializer !== undefined && isAssignedFunction(initializer)) {
      const methodSymbol = this.createSymbol("method", name, node, ast, context, {
        parameters: getParameters(initializer),
        async: initializer.attributes.async === true,
      });
      symbols.push(methodSymbol);
      this.visitChildren(node, ast, {
        ...context,
        enclosingAssignedName: name,
        enclosingAssignedId: methodSymbol.id,
      }, symbols, pendingExports);
      return;
    } else {
      const value = readLiteralInitializer(node);
      symbols.push(
        this.createSymbol("variable", name, node, ast, context, {
          ...(value === undefined ? {} : { value }),
        }),
      );
    }

    this.visitChildren(node, ast, context, symbols, pendingExports);
  }

  private addExportSymbol(
    node: ASTNode,
    ast: ASTResult,
    defaultExport: boolean,
    symbols: CodeSymbol[],
    context: ExtractionContext,
    pendingExports: PendingExportBinding[],
  ): void {
    const moduleSpecifier = findModuleSpecifier(node);
    const specifiers = node.children.filter((child) =>
      child.role === "specifiers" && (child.type === "ExportSpecifier" || child.type === "ExportNamespaceSpecifier"),
    );

    if (specifiers.length === 0) {
      if (defaultExport) {
        const decl = node.children.find((child) => child.role === "declaration");
        const localName = decl ? (readIdentifierName(decl) ?? getName(decl)) : undefined;
        const defaultExported = this.addExport(node, ast, "default", true, moduleSpecifier, localName, symbols);
        // Overloads of `export default function f`: the implementation owns the default export.
        const declarationRank = decl === undefined || moduleSpecifier !== undefined ? undefined
          : decl.type === "TSDeclareFunction" || decl.type === "FunctionDeclaration" ? declarationRanks.get(decl.type) : undefined;
        if (declarationRank !== undefined) this.declaredExports.set(defaultExported.id, declarationRank);
        if (localName !== undefined && moduleSpecifier === undefined) {
          pendingExports.push({ name: localName, scopeChain: context.scopeChain });
        }
      } else {
        for (const { name, rank } of findDeclaredNames(node)) {
          const exported = this.addExport(node, ast, name, false, moduleSpecifier, undefined, symbols);
          this.declaredExports.set(exported.id, rank);
        }
      }
      return;
    }

    for (const specifier of specifiers) {
      const exportedName = readStringAttribute(specifier, "exportedName")
        ?? readIdentifierName(specifier.children.find((child) => child.role === "exported"))
        ?? "default";
      const sourceSymbolName = specifier.type === "ExportNamespaceSpecifier"
        ? "*"
        : readStringAttribute(specifier, "sourceSymbolName")
          ?? readIdentifierName(specifier.children.find((child) => child.role === "local"));
      const isDefault = defaultExport || exportedName === "default";
      const specified = this.addExport(node, ast, defaultExport ? "default" : exportedName, isDefault, moduleSpecifier, sourceSymbolName, symbols);
      if (!isDefault && moduleSpecifier === undefined && sourceSymbolName !== undefined && sourceSymbolName !== "*") {
        this.declaredExports.set(specified.id, { local: sourceSymbolName });
      }
      if (sourceSymbolName !== undefined && sourceSymbolName !== "*" && moduleSpecifier === undefined) {
        pendingExports.push({ name: sourceSymbolName, scopeChain: context.scopeChain });
      }
    }
  }

  private addExport(
    node: ASTNode,
    ast: ASTResult,
    name: string,
    defaultExport: boolean,
    moduleSpecifier: string | undefined,
    sourceSymbolName: string | undefined,
    symbols: CodeSymbol[],
  ): CodeSymbol {
    const symbol = this.createSymbol("export", name, node, ast, {
      ...initialContext,
      exported: true,
      defaultExport,
    }, {
      ...(moduleSpecifier === undefined ? {} : { moduleSpecifier }),
      ...(sourceSymbolName === undefined ? {} : { sourceSymbolName }),
    });
    symbols.push(symbol);
    return symbol;
  }

  /**
   * An `export` inside a namespace or ambient module body exports a member of that namespace, never
   * of the file: it creates no `export` symbol. The declaration it wraps is visited as an exported
   * member, and `export { a }` / `export default a` mark the namespace's own `a` as exported.
   */
  private addNamespaceExport(
    node: ASTNode,
    ast: ASTResult,
    defaultExport: boolean,
    symbols: CodeSymbol[],
    context: ExtractionContext,
    pendingExports: PendingExportBinding[],
  ): void {
    if (findModuleSpecifier(node) === undefined) {
      for (const specifier of node.children.filter((child) => child.role === "specifiers" && child.type === "ExportSpecifier")) {
        const local = readStringAttribute(specifier, "sourceSymbolName")
          ?? readIdentifierName(specifier.children.find((child) => child.role === "local"));
        if (local !== undefined) pendingExports.push({ name: local, scopeChain: context.scopeChain });
      }
      const declaration = node.children.find((child) => child.role === "declaration");
      if (defaultExport && declaration?.type === "Identifier") {
        const local = readIdentifierName(declaration);
        if (local !== undefined) pendingExports.push({ name: local, scopeChain: context.scopeChain });
      }
    }
    this.visitChildren(node, ast, { ...context, exported: true, defaultExport }, symbols, pendingExports);
  }

  /**
   * `namespace NS {}`, `module M {}`, `declare module "x" {}` and `declare global {}`: each opens a
   * lexical scope for its members. Only an identifier-named namespace declares a binding (a `namespace`
   * symbol, named by the outermost identifier of `A.B.C`); a string-named module declares no identifier
   * and `global` augments the global scope, so neither adds a symbol to the enclosing scope.
   */
  private addModuleDeclaration(
    node: ASTNode,
    ast: ASTResult,
    context: ExtractionContext,
    symbols: CodeSymbol[],
    pendingExports: PendingExportBinding[],
  ): void {
    const id = node.children.find((child) => child.role === "id");
    const body = node.children.find((child) => child.role === "body");
    const isGlobal = node.attributes.kind === "global";
    const path = isGlobal ? "global" : modulePath(id);
    const binding = isGlobal || id?.type === "StringLiteral" ? undefined : path?.split(".")[0];
    if (binding !== undefined) symbols.push(this.createSymbol("namespace", binding, node, ast, context));
    if (body === undefined) return;

    const scopeId = createLexicalScopeId(node.type, node.location);
    const enclosing = context.namespaceBody === true && binding !== undefined && context.containerName !== undefined
      ? `${context.containerName}.`
      : "";
    const ambient = context.ambient === true || node.attributes.declare === true || DECLARATION_FILE.test(ast.metadata.sourcePath);
    this.visit(body, ast, {
      ...context,
      // TypeScript exports every member of an ambient namespace or module that has no export declaration.
      exported: ambient && !isGlobal && !hasExportDeclarations(body),
      defaultExport: false,
      ambient,
      containerName: path === undefined ? undefined : `${enclosing}${path}`,
      // containerId names a class; a namespace is not one.
      containerId: undefined,
      enclosingAssignedName: undefined,
      enclosingAssignedId: undefined,
      scopeId,
      functionScopeId: scopeId,
      scopeChain: [scopeId, ...context.scopeChain],
      namespaceBody: true,
    }, symbols, pendingExports);
  }

  /**
   * `import x = require("m")` binds the module like `const x = require("m")`: an import symbol, its
   * module reference and the same source anchor. `import A = NS.B` aliases an entity and imports no module.
   */
  private addImportEqualsSymbols(
    node: ASTNode,
    ast: ASTResult,
    context: ExtractionContext,
    symbols: CodeSymbol[],
  ): void {
    const name = readIdentifierName(node.children.find((child) => child.role === "id"));
    const reference = node.children.find((child) => child.role === "moduleReference");
    if (name === undefined || reference === undefined) return;

    if (reference.type === "TSExternalModuleReference") {
      const moduleSpecifier = nonEmptyString(reference.children.find((child) => child.role === "expression")?.attributes.value);
      if (moduleSpecifier === undefined) return;
      const symbolStart = symbols.length;
      symbols.push(this.createSymbol("import", name, node, ast, initialContext, { moduleSpecifier, defaultExport: true }));
      this.addModuleReference(node, moduleSpecifier, "commonjs-import", symbols.slice(symbolStart), node.attributes.importKind === "type" ? "type" : undefined);
      return;
    }

    const target = modulePath(reference);
    symbols.push(this.createSymbol("variable", name, node, ast, context, {
      declarationKind: "const",
      ...(target === undefined ? {} : { sourceSymbolName: target }),
    }));
  }

  /**
   * `export = x` is the TypeScript spelling of `module.exports = x`: a default export sourced from the
   * identifier, which becomes exported. Inside an ambient module it exports from that module only.
   */
  private addExportAssignment(
    node: ASTNode,
    ast: ASTResult,
    context: ExtractionContext,
    symbols: CodeSymbol[],
    pendingExports: PendingExportBinding[],
  ): void {
    const expression = node.children.find((child) => child.role === "expression");
    const local = expression?.type === "Identifier" ? readIdentifierName(expression) : undefined;
    if (context.namespaceBody !== true) this.addExport(node, ast, "default", true, undefined, local, symbols);
    if (local !== undefined) pendingExports.push({ name: local, scopeChain: context.scopeChain });
    if (expression !== undefined) {
      this.visit(expression, ast, { ...context, exported: false, defaultExport: false }, symbols, pendingExports);
    }
  }

  private processAssignment(
    node: ASTNode,
    ast: ASTResult,
    context: ExtractionContext,
    symbols: CodeSymbol[],
    pendingExports: PendingExportBinding[],
  ): void {
    const targets: ASTNode[] = [];
    let current: ASTNode | undefined = node;
    let innermostRight: ASTNode | undefined;
    let innermostOperator: unknown;

    while (current && current.type === "AssignmentExpression") {
      innermostOperator = current.attributes.operator;
      const left = current.children.find((child) => child.role === "left");
      const rightChild: ASTNode | undefined = current.children.find((child) => child.role === "right");
      if (left) targets.push(left);
      innermostRight = rightChild;
      current = rightChild;
    }

    if (innermostRight === undefined || targets.length === 0) return;

    // Check for require(...) on RHS
    const required = requireSpecifier(innermostRight);
    const symbolStart = symbols.length;
    if (required !== undefined) {
      const property = requireProperty(innermostRight);
      const isDefaultReq = property === undefined;
      for (const target of targets) {
        const tPath = memberPath(target);
        const name = (tPath ? tPath.split(".").at(-1) : undefined) ?? property ?? required;
        symbols.push(
          this.createSymbol("import", name, node, ast, initialContext, {
            moduleSpecifier: required,
            sourceSymbolName: property ?? (isDefaultReq ? undefined : name),
            defaultExport: isDefaultReq,
          }),
        );
      }
    }

    if (required !== undefined) this.addModuleReference(node, required, "commonjs-import", symbols.slice(symbolStart));

    // Process targets for exports and property assignments
    for (const target of targets) {
      const targetPath = memberPath(target);
      if (!targetPath) continue;

      if (targetPath === "module.exports") {
        if (innermostRight.type === "ObjectExpression") {
          const properties = findObjectProperties(innermostRight);
          for (const prop of properties) {
            this.addExport(prop.node, ast, prop.key, false, undefined, prop.localSymbolName, symbols);
            const symbolToMark = prop.localSymbolName ?? prop.key;
            pendingExports.push({ name: symbolToMark, scopeChain: context.scopeChain });
          }
          this.addExport(node, ast, "default", true, undefined, undefined, symbols);
        } else if (innermostRight.type === "Identifier") {
          const varName = readIdentifierName(innermostRight);
          if (varName !== undefined) {
            const resolvedObj = findVariableObjectExpression(ast.root, varName);
            if (resolvedObj !== undefined) {
              const properties = findObjectProperties(resolvedObj);
              for (const prop of properties) {
                this.addExport(prop.node, ast, prop.key, false, undefined, prop.localSymbolName, symbols);
                const symbolToMark = prop.localSymbolName ?? prop.key;
                pendingExports.push({ name: symbolToMark, scopeChain: context.scopeChain });
              }
            }
            pendingExports.push({ name: varName, scopeChain: context.scopeChain });
            this.addExport(node, ast, "default", true, undefined, varName, symbols);
          }
        } else {
          const rightName = identifierName(innermostRight);
          this.addExport(node, ast, "default", true, undefined, rightName, symbols);
          if (rightName) {
            pendingExports.push({ name: rightName, scopeChain: context.scopeChain });
          }
        }
      } else if (targetPath.startsWith("module.exports.") || targetPath.startsWith("exports.")) {
        // `exports.x = void 0` is how tsc pre-declares an export before assigning it (BA-12).
        if (isVoidPlaceholder(innermostRight)) continue;
        const propName = targetPath.split(".").at(-1);
        if (propName && propName.length > 0) {
          const sourceSymbolName = identifierName(innermostRight);
          this.addExport(node, ast, propName, false, undefined, sourceSymbolName, symbols);
          const symbolToMark = sourceSymbolName ?? propName;
          pendingExports.push({ name: symbolToMark, scopeChain: context.scopeChain });
          symbols.push(
            this.createSymbol("variable", propName, target, ast, {
              ...context,
              containerName: targetPath.startsWith("module.exports") ? "module.exports" : "exports",
              exported: true,
            }, {
              sourceSymbolName: sourceSymbolName ?? propName,
            }),
          );
        }
      } else if (targetPath.includes(".")) {
        const parts = targetPath.split(".");
        const propName = parts.at(-1)!;
        const receiverName = parts.slice(0, -1).join(".");

        if (innermostRight.type === "FunctionExpression" || innermostRight.type === "ArrowFunctionExpression") {
          const funcParams = getParameters(innermostRight);
          const funcName = getName(innermostRight) ?? propName;
          symbols.push(
            this.createSymbol("method", propName, innermostRight, ast, {
              ...context,
              containerName: receiverName,
            }, {
              parameters: funcParams,
              sourceSymbolName: funcName !== propName ? funcName : undefined,
            }),
          );
        } else {
          const sourceSymbolName = identifierName(innermostRight);
          symbols.push(
            this.createSymbol("variable", propName, target, ast, {
              ...context,
              containerName: receiverName,
            }, {
              ...(sourceSymbolName === undefined ? {} : { sourceSymbolName }),
            }),
          );
        }
      } else if (innermostRight.type === "FunctionExpression" || innermostRight.type === "ArrowFunctionExpression") {
        const funcParams = getParameters(innermostRight);
        symbols.push(
          this.createSymbol("function", targetPath, innermostRight, ast, context, {
            parameters: funcParams,
            anonymous: false,
          }),
        );
      }
    }

    if (innermostRight) {
      if (innermostRight.type === "ClassExpression") {
        const target = targets.at(-1);
        const targetName = target?.type === "Identifier" && innermostOperator === "=" ? readIdentifierName(target) : undefined;
        if (targetName !== undefined) this.classBindingNames.set(innermostRight, targetName);
        this.visit(innermostRight, ast, context, symbols, pendingExports);
      } else if (innermostRight.type === "FunctionExpression" || innermostRight.type === "ArrowFunctionExpression") {
        const fnScopeId = createLexicalScopeId(innermostRight.type, innermostRight.location);
        const matchingSymbol = symbols.find(
          (s) => (s.kind === "function" || s.kind === "method") &&
            s.location !== undefined &&
            innermostRight.location !== undefined &&
            s.location.start.line === innermostRight.location.start.line &&
            s.location.start.column === innermostRight.location.start.column,
        );
        const fnName = matchingSymbol?.name ?? getName(innermostRight);
        const fnId = matchingSymbol?.id;
        this.extractParameterSymbols(innermostRight, ast, fnScopeId, fnName, fnId, symbols);
        this.visitChildren(innermostRight, ast, {
          ...context,
          scopeId: fnScopeId,
          functionScopeId: fnScopeId,
          scopeChain: [fnScopeId, ...context.scopeChain],
        }, symbols, pendingExports);
      } else {
        this.visitChildren(innermostRight, ast, context, symbols, pendingExports);
      }
    }
  }

  private markLocalSymbolAsExported(
    name: string,
    symbols: CodeSymbol[],
    scopeChain?: readonly string[] | string,
  ): void {
    const isExportable = (sym: CodeSymbol): boolean =>
      sym.name === name &&
      (sym.kind === "function" || sym.kind === "variable" || sym.kind === "class"
        || sym.kind === "enum" || sym.kind === "namespace" || sym.kind === "interface" || sym.kind === "type-alias");

    const chain: readonly string[] =
      scopeChain === undefined
        ? ["scope:module"]
        : typeof scopeChain === "string"
          ? scopeChain === "scope:module"
            ? ["scope:module"]
            : [scopeChain, "scope:module"]
          : scopeChain;

    for (const scopeId of chain) {
      let found = false;
      for (let i = 0; i < symbols.length; i++) {
        const sym = symbols[i]!;
        if (sym.scopeId === scopeId && isExportable(sym)) {
          symbols[i] = { ...sym, exported: true };
          found = true;
        }
      }
      if (found) {
        return;
      }
    }
  }

  private createSymbol(
    kind: SymbolKind,
    name: string,
    node: ASTNode,
    ast: ASTResult,
    context: ExtractionContext,
    overrides: Partial<CodeSymbol> = {},
  ): CodeSymbol {
    const location = node.location;
    const position = location === undefined ? `anon-${this.unlocatedSequence++}` : `${location.start.line}:${location.start.column}`;

    return {
      id: createHash("sha256")
        .update(`${ast.metadata.sourcePath}:${kind}:${name}:${position}`)
        .digest("hex"),
      kind,
      name,
      filePath: ast.metadata.sourcePath,
      language: ast.metadata.language,
      exported: context.exported,
      defaultExport: context.defaultExport,
      async: node.attributes.async === true,
      anonymous: name.startsWith("anonymous-"),
      visibility: "public",
      parameters: [],
      containerName: context.containerName,
      containerId: context.containerId,
      scopeId: context.scopeId,
      location,
      ...overrides,
    };
  }
}

function createSummary(symbols: readonly CodeSymbol[]): SymbolSummary {
  return {
    classes: countSymbols(symbols, "class"),
    exports: countSymbols(symbols, "export"),
    functions: countSymbols(symbols, "function"),
    imports: countSymbols(symbols, "import"),
    methods: countSymbols(symbols, "method"),
    variables: countSymbols(symbols, "variable"),
  };
}

function countSymbols(symbols: readonly CodeSymbol[], kind: SymbolKind): number {
  return symbols.filter((symbol) => symbol.kind === kind).length;
}

function getName(node: ASTNode): string | undefined {
  if (node.type === "Identifier" || node.type === "PrivateName") {
    return readIdentifierName(node);
  }
  const keyChild = node.children.find((child) => child.role === "key");
  if (keyChild?.type === "StringLiteral" && node.attributes.computed !== true) {
    return nonEmptyString(keyChild.attributes.value);
  }
  return readIdentifierName(node.children.find((child) => child.role === "id"))
    ?? readIdentifierName(keyChild)
    ?? readIdentifierName(node.children.find((child) => child.role === "local"))
    ?? readIdentifierName(node.children.find((child) => child.role === "exported"));
}

function getParameters(node: ASTNode): readonly string[] {
  return node.children
    .filter((child) => child.role === "params" || child.role === "param")
    .flatMap((child) => extractBoundNames(child));
}

/** The declarations an `export <declaration>` can name, and how strongly each owns its export symbol. */
const declarationRanks: ReadonlyMap<string, ExportRank> = new Map<string, ExportRank>([
  ["ClassDeclaration", VALUE_DECLARATION],
  ["FunctionDeclaration", VALUE_DECLARATION],
  ["VariableDeclaration", VALUE_DECLARATION],
  ["TSDeclareFunction", MERGEABLE_DECLARATION],
  ["TSEnumDeclaration", MERGEABLE_DECLARATION],
  ["TSModuleDeclaration", MERGEABLE_DECLARATION],
  ["TSImportEqualsDeclaration", MERGEABLE_DECLARATION],
  ["TSInterfaceDeclaration", TYPE_DECLARATION],
  ["TSTypeAliasDeclaration", TYPE_DECLARATION],
]);

function findDeclaredNames(node: ASTNode): readonly { readonly name: string; readonly rank: ExportRank }[] {
  const declaration = node.children.find((child) => child.role === "declaration" && declarationRanks.has(child.type));
  if (declaration === undefined) return [];
  const rank = declarationRanks.get(declaration.type)!;
  const named = (names: readonly string[]) => names.map((name) => ({ name, rank }));
  if (declaration.type === "VariableDeclaration") {
    return named(declaration.children
      .filter((child) => child.role === "declarations" && child.type === "VariableDeclarator")
      .flatMap((child) => {
        const binding = child.children.find((c) => c.role === "id");
        if (binding?.type === "ObjectPattern" || binding?.type === "ArrayPattern") {
          return extractBoundNames(binding);
        }
        const name = getName(child);
        return name === undefined ? [] : [name];
      }));
  }
  if (declaration.type === "TSModuleDeclaration") {
    // `export namespace A.B.C` exports `A`; a string-named module or `global` is not an exportable name.
    const id = declaration.children.find((child) => child.role === "id");
    const outermost = id?.type === "StringLiteral" || declaration.attributes.kind === "global" ? undefined : modulePath(id)?.split(".")[0];
    return named(outermost === undefined ? [] : [outermost]);
  }

  const name = getName(declaration);
  return named(name === undefined ? [] : [name]);
}

/** An export declaration or assignment in a namespace body turns off the implicit export of its ambient members. */
function hasExportDeclarations(body: ASTNode): boolean {
  return body.children.some((statement) =>
    statement.type === "ExportAllDeclaration"
    || statement.type === "TSExportAssignment"
    || (statement.type === "ExportNamedDeclaration" && !statement.children.some((child) => child.role === "declaration"))
    || (statement.type === "ExportDefaultDeclaration"
      && !statement.children.some((child) => child.role === "declaration" && declarationRanks.has(child.type))));
}

/** `A.B.C` for a qualified name, the text of a string-named module, otherwise the identifier. */
function modulePath(node: ASTNode | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (node.type === "StringLiteral") return nonEmptyString(node.attributes.value);
  if (node.type === "TSQualifiedName") {
    const left = modulePath(node.children.find((child) => child.role === "left"));
    const right = readIdentifierName(node.children.find((child) => child.role === "right"));
    return left === undefined || right === undefined ? undefined : `${left}.${right}`;
  }
  return readIdentifierName(node);
}

function extractBoundIdentifierNodes(node: ASTNode | undefined): readonly ASTNode[] {
  if (!node) return [];
  switch (node.type) {
    case "Identifier": {
      const name = readIdentifierName(node);
      if (name === undefined || name === "this") return [];
      return [node];
    }
    case "AssignmentPattern": {
      const left = node.children.find((c) => c.role === "left");
      return extractBoundIdentifierNodes(left);
    }
    case "RestElement": {
      const argument = node.children.find((c) => c.role === "argument");
      return extractBoundIdentifierNodes(argument);
    }
    case "ObjectPattern": {
      return node.children.flatMap((child) => {
        if (child.type === "ObjectProperty" || child.role === "properties") {
          const valChild = child.children.find((c) => c.role === "value");
          if (valChild !== undefined) {
            return extractBoundIdentifierNodes(valChild);
          }
          const keyChild = child.children.find((c) => c.role === "key") ?? child.children.find((c) => c.type === "Identifier");
          return extractBoundIdentifierNodes(keyChild);
        }
        if (child.type === "RestElement") {
          return extractBoundIdentifierNodes(child);
        }
        return [];
      });
    }
    case "ArrayPattern": {
      return node.children.filter((c) => c.role === "elements").flatMap(extractBoundIdentifierNodes);
    }
    case "TSParameterProperty": {
      const parameter = node.children.find((c) => c.role === "parameter");
      return extractBoundIdentifierNodes(parameter);
    }
    default:
      return [];
  }
}

function extractBoundNames(node: ASTNode | undefined): readonly string[] {
  return extractBoundIdentifierNodes(node)
    .map((n) => readIdentifierName(n))
    .filter((name): name is string => name !== undefined);
}

function findStringLiteral(node: ASTNode): string | undefined {
  if (node.type === "StringLiteral") {
    return nonEmptyString(node.attributes.value);
  }

  for (const child of node.children) {
    const value = findStringLiteral(child);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function findModuleSpecifier(node: ASTNode): string | undefined {
  const sourceAttribute = node.attributes.source;
  const sourceFromAttribute = nonEmptyString(sourceAttribute);
  if (sourceFromAttribute !== undefined) {
    return sourceFromAttribute;
  }

  const source = node.children.find((child) => child.role === "source");
  const sourceValue = nonEmptyString(source?.attributes.value);
  if (sourceValue !== undefined) {
    return sourceValue;
  }

  return source === undefined ? undefined : findStringLiteral(source);
}

function readIdentifierName(node: ASTNode | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (node.type === "PrivateName") {
    const id = node.children.find((child) => child.role === "id");
    const name = id?.attributes.name;
    return typeof name === "string" ? `#${name}` : undefined;
  }
  const name = node.attributes.name;

  return typeof name === "string" ? name : undefined;
}

function readStringAttribute(node: ASTNode, key: string): string | undefined {
  return nonEmptyString(node.attributes[key]);
}

function identifierName(node: ASTNode | undefined): string | undefined {
  return readIdentifierName(node);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readDeclarationKind(node: ASTNode): "const" | "let" | "var" | undefined {
  const kind = node.attributes.kind;

  return kind === "const" || kind === "let" || kind === "var" ? kind : undefined;
}

function readLiteralInitializer(node: ASTNode): string | number | boolean | null | undefined {
  const initializer = node.children.find((child) => child.role === "init" || child.role === "value");
  const value = initializer?.attributes.value;

  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null
    ? value
    : undefined;
}

function isAssignedFunction(node: ASTNode): boolean {
  return node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression";
}

function requireSpecifier(node: ASTNode | undefined): string | undefined {
  if (node?.type === "CallExpression") return requireArgument(node);
  if (node?.type === "MemberExpression") return requireSpecifier(node.children.find((child) => child.role === "object"));
  return undefined;
}

function requireArgument(node: ASTNode): string | undefined {
  const callee = node.children.find((child) => child.role === "callee");
  if (identifierName(callee) !== "require") return undefined;
  const argument = node.children.find((child) => child.role === "arguments");
  return argument?.type === "StringLiteral" ? nonEmptyString(argument.attributes.value) : undefined;
}

function isVoidPlaceholder(node: ASTNode): boolean {
  return node.type === "UnaryExpression" && node.attributes.operator === "void"
    && node.children.every((child) => child.type === "NumericLiteral");
}

function requireProperty(node: ASTNode | undefined): string | undefined {
  if (node?.type !== "MemberExpression") return undefined;
  return identifierName(node.children.find((child) => child.role === "property"));
}

function bindingNames(node: ASTNode | undefined): readonly string[] {
  if (node === undefined) return [];
  const name = identifierName(node);
  if (name !== undefined) return [name];
  return [...new Set(node.children.flatMap(bindingNames))];
}

function memberPath(node: ASTNode | undefined): string | undefined {
  if (node?.type === "Identifier") return identifierName(node);
  if (node?.type !== "MemberExpression") return undefined;
  const object = memberPath(node.children.find((child) => child.role === "object"));
  const property = identifierName(node.children.find((child) => child.role === "property"));
  return object === undefined || property === undefined ? undefined : `${object}.${property}`;
}

interface ExtractedProperty {
  readonly key: string;
  readonly localSymbolName?: string;
  readonly node: ASTNode;
}

function findObjectProperties(node: ASTNode): readonly ExtractedProperty[] {
  if (node.type !== "ObjectExpression") return [];
  const props: ExtractedProperty[] = [];
  const seen = new Set<string>();

  for (const child of node.children) {
    if (child.type !== "ObjectProperty" && child.role !== "properties") continue;
    const keyChild = child.children.find((c) => c.role === "key")
      ?? child.children.find((c) => c.type === "Identifier" || c.type === "StringLiteral");
    const valChild = child.children.find((c) => c.role === "value");

    const keyName = readIdentifierOrLiteral(keyChild);
    if (!keyName || seen.has(keyName)) continue;
    seen.add(keyName);

    const valName = readIdentifierOrLiteral(valChild);
    props.push({
      key: keyName,
      localSymbolName: valName ?? (child.attributes.shorthand === true ? keyName : undefined),
      node: child,
    });
  }
  return props;
}

function readIdentifierOrLiteral(node: ASTNode | undefined): string | undefined {
  if (!node) return undefined;
  if (typeof node.attributes.name === "string" && node.attributes.name.length > 0) return node.attributes.name;
  if (typeof node.attributes.value === "string" && node.attributes.value.length > 0) return String(node.attributes.value);
  return undefined;
}

function findVariableObjectExpression(root: ASTNode, varName: string): ASTNode | undefined {
  for (const child of root.children) {
    if (child.type === "VariableDeclaration") {
      for (const decl of child.children.filter((c) => c.type === "VariableDeclarator" || c.role === "declarations")) {
        const idChild = decl.children.find((c) => c.role === "id") ?? decl.children.find((c) => c.type === "Identifier");
        if (idChild?.attributes.name === varName) {
          const initChild = decl.children.find((c) => c.role === "init");
          if (initChild?.type === "ObjectExpression") {
            return initChild;
          }
        }
      }
    }
  }
  return undefined;
}
