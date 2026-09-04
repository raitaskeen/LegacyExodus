import { createHash } from "node:crypto";

import { validateASTResult, type ASTNode, type ASTResult } from "@parser/index";

import type { SymbolExtractor } from "./symbol-extractor";
import {
  validateSymbolTable,
  type CodeSymbol,
  type SymbolKind,
  type SymbolSummary,
  type SymbolTable,
  createLexicalScopeId,
} from "./symbol-contracts";
import { UnsupportedSymbolLanguageError } from "./symbol-errors";

interface ExtractionContext {
  readonly exported: boolean;
  readonly defaultExport: boolean;
  readonly containerName?: string;
  readonly containerId?: string;
  readonly scopeId: string;
  readonly functionScopeId?: string;
  readonly scopeChain: readonly string[];
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

export class JavaScriptSymbolExtractor implements SymbolExtractor {
  private unlocatedSequence = 0;

  public extract(ast: ASTResult): SymbolTable {
    const validatedAst = validateASTResult(ast);

    if (!supportedLanguages.has(validatedAst.metadata.language)) {
      throw new UnsupportedSymbolLanguageError(validatedAst.metadata.language);
    }

    this.unlocatedSequence = 0;
    const symbols: CodeSymbol[] = [];
    const pendingExports: PendingExportBinding[] = [];
    this.visit(validatedAst.root, validatedAst, initialContext, symbols, pendingExports);

    for (const pending of pendingExports) {
      this.markLocalSymbolAsExported(pending.name, symbols, pending.scopeChain);
    }

    return validateSymbolTable({
      filePath: validatedAst.metadata.sourcePath,
      language: validatedAst.metadata.language,
      symbols,
      summary: createSummary(symbols),
    });
  }

  private visit(
    node: ASTNode,
    ast: ASTResult,
    context: ExtractionContext,
    symbols: CodeSymbol[],
    pendingExports: PendingExportBinding[],
  ): void {
    switch (node.type) {
      case "ExportNamedDeclaration":
        this.addExportSymbol(node, ast, false, symbols, context, pendingExports);
        this.visitChildren(node, ast, { ...context, exported: true }, symbols, pendingExports);
        return;
      case "ExportDefaultDeclaration":
        this.addExportSymbol(node, ast, true, symbols, context, pendingExports);
        this.visitChildren(node, ast, { ...context, exported: true, defaultExport: true }, symbols, pendingExports);
        return;
      case "ExportAllDeclaration":
        symbols.push(this.createSymbol("export", "*", node, ast, { ...initialContext, exported: true, defaultExport: false }, {
          moduleSpecifier: findModuleSpecifier(node),
        }));
        return;
      case "ImportDeclaration":
        this.addImportSymbols(node, ast, symbols);
        return;
      case "VariableDeclaration":
        this.addVariableSymbols(node, ast, context, symbols);
        break;
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
        this.addFunctionSymbol(node, ast, context, symbols);
        this.visitChildren(node, ast, {
          ...context,
          scopeId: fnScopeId,
          functionScopeId: fnScopeId,
          scopeChain: [fnScopeId, ...context.scopeChain],
        }, symbols, pendingExports);
        return;
      }
      case "FunctionExpression":
      case "ArrowFunctionExpression": {
        const fnScopeId = createLexicalScopeId(node.type, node.location);
        this.visitChildren(node, ast, {
          ...context,
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
      case "ClassMethod":
      case "ClassPrivateMethod": {
        const methodScopeId = createLexicalScopeId(node.type, node.location);
        this.addMethodSymbol(node, ast, context, symbols);
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
        this.addMethodSymbol(node, ast, context, symbols);
        this.visitChildren(node, ast, {
          ...context,
          scopeId: methodScopeId,
          functionScopeId: methodScopeId,
          scopeChain: [methodScopeId, ...context.scopeChain],
        }, symbols, pendingExports);
        return;
      }
      default:
        break;
    }

    this.visitChildren(node, ast, context, symbols, pendingExports);
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
    const moduleSpecifier = findStringLiteral(node) ?? "unknown-module";
    const specifiers = node.children.filter(
      (child) => child.role === "specifiers" && child.type.startsWith("Import"),
    );

    if (specifiers.length === 0) {
      symbols.push(this.createSymbol("import", moduleSpecifier, node, ast, initialContext, { moduleSpecifier }));
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
    }
  }

  private addFunctionSymbol(
    node: ASTNode,
    ast: ASTResult,
    context: ExtractionContext,
    symbols: CodeSymbol[],
  ): void {
    const name = getName(node) ?? "anonymous-function";
    symbols.push(this.createSymbol("function", name, node, ast, context, { parameters: getParameters(node) }));
  }

  private addMethodSymbol(
    node: ASTNode,
    ast: ASTResult,
    context: ExtractionContext,
    symbols: CodeSymbol[],
  ): void {
    const name = getName(node) ?? "anonymous-method";
    symbols.push(this.createSymbol("method", name, node, ast, context, { parameters: getParameters(node) }));
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
        this.addExport(node, ast, "default", true, moduleSpecifier, localName, symbols);
        if (localName !== undefined && moduleSpecifier === undefined) {
          pendingExports.push({ name: localName, scopeChain: context.scopeChain });
        }
      } else {
        const names = findDeclaredNames(node);
        for (const name of names) {
          this.addExport(node, ast, name, false, moduleSpecifier, undefined, symbols);
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
      this.addExport(node, ast, defaultExport ? "default" : exportedName, isDefault, moduleSpecifier, sourceSymbolName, symbols);
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
  ): void {
    symbols.push(
      this.createSymbol("export", name, node, ast, {
        ...initialContext,
        exported: true,
        defaultExport,
      }, {
        ...(moduleSpecifier === undefined ? {} : { moduleSpecifier }),
        ...(sourceSymbolName === undefined ? {} : { sourceSymbolName }),
      }),
    );
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

    while (current && current.type === "AssignmentExpression") {
      const left = current.children.find((child) => child.role === "left");
      const rightChild: ASTNode | undefined = current.children.find((child) => child.role === "right");
      if (left) targets.push(left);
      innermostRight = rightChild;
      current = rightChild;
    }

    if (innermostRight === undefined || targets.length === 0) return;

    // Check for require(...) on RHS
    const required = requireSpecifier(innermostRight);
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
      if (innermostRight.type === "FunctionExpression" || innermostRight.type === "ArrowFunctionExpression") {
        const fnScopeId = createLexicalScopeId(innermostRight.type, innermostRight.location);
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
      (sym.kind === "function" || sym.kind === "variable" || sym.kind === "class");

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
  if (node.type === "Identifier") {
    return readIdentifierName(node);
  }
  return readIdentifierName(node.children.find((child) => child.role === "id"))
    ?? readIdentifierName(node.children.find((child) => child.role === "key"))
    ?? readIdentifierName(node.children.find((child) => child.role === "local"))
    ?? readIdentifierName(node.children.find((child) => child.role === "exported"));
}

function getParameters(node: ASTNode): readonly string[] {
  return node.children
    .filter((child) => child.role === "params")
    .flatMap((child) => extractBoundNames(child));
}

function findDeclaredNames(node: ASTNode): readonly string[] {
  const declaration = node.children.find((child) =>
    child.role === "declaration" &&
    ["ClassDeclaration", "FunctionDeclaration", "VariableDeclaration"].includes(child.type),
  );
  if (declaration === undefined) return [];
  if (declaration.type === "VariableDeclaration") {
    return declaration.children
      .filter((child) => child.role === "declarations" && child.type === "VariableDeclarator")
      .flatMap((child) => {
        const binding = child.children.find((c) => c.role === "id");
        if (binding?.type === "ObjectPattern" || binding?.type === "ArrayPattern") {
          return extractBoundNames(binding);
        }
        const name = getName(child);
        return name === undefined ? [] : [name];
      });
  }

  const name = getName(declaration);
  return name === undefined ? [] : [name];
}

function extractBoundNames(node: ASTNode | undefined): readonly string[] {
  if (!node) return [];
  switch (node.type) {
    case "Identifier": {
      const name = readIdentifierName(node);
      return name !== undefined ? [name] : [];
    }
    case "AssignmentPattern": {
      const left = node.children.find((c) => c.role === "left");
      return extractBoundNames(left);
    }
    case "RestElement": {
      const argument = node.children.find((c) => c.role === "argument");
      return extractBoundNames(argument);
    }
    case "ObjectPattern": {
      return node.children.flatMap((child) => {
        if (child.type === "ObjectProperty" || child.role === "properties") {
          const valChild = child.children.find((c) => c.role === "value");
          if (valChild !== undefined) {
            return extractBoundNames(valChild);
          }
          const keyChild = child.children.find((c) => c.role === "key") ?? child.children.find((c) => c.type === "Identifier");
          return extractBoundNames(keyChild);
        }
        if (child.type === "RestElement") {
          return extractBoundNames(child);
        }
        return [];
      });
    }
    case "ArrayPattern": {
      return node.children.filter((c) => c.role === "elements").flatMap(extractBoundNames);
    }
    default:
      return [];
  }
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

  return source === undefined ? findStringLiteral(node) : findStringLiteral(source);
}

function readIdentifierName(node: ASTNode | undefined): string | undefined {
  const name = node?.attributes.name;

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
  const initializer = node.children.find((child) => child.role === "init");
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
