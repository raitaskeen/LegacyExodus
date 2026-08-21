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
}

const initialContext: ExtractionContext = Object.freeze({
  exported: false,
  defaultExport: false,
  scopeId: "scope:module",
});

const supportedLanguages = new Set(["javascript", "typescript"]);

export class JavaScriptSymbolExtractor implements SymbolExtractor {
  public extract(ast: ASTResult): SymbolTable {
    const validatedAst = validateASTResult(ast);

    if (!supportedLanguages.has(validatedAst.metadata.language)) {
      throw new UnsupportedSymbolLanguageError(validatedAst.metadata.language);
    }

    const symbols: CodeSymbol[] = [];
    this.visit(validatedAst.root, validatedAst, initialContext, symbols);

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
  ): void {
    switch (node.type) {
      case "ExportNamedDeclaration":
        this.addExportSymbol(node, ast, false, symbols);
        this.visitChildren(node, ast, { ...context, exported: true }, symbols);
        return;
      case "ExportDefaultDeclaration":
        this.addExportSymbol(node, ast, true, symbols);
        this.visitChildren(node, ast, { ...context, exported: true, defaultExport: true }, symbols);
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
      case "BlockStatement":
        this.visitChildren(node, ast, { ...context, scopeId: createLexicalScopeId(node.type, node.location) }, symbols);
        return;
      case "AssignmentExpression":
        this.addCommonJsExport(node, ast, symbols);
        break;
      case "FunctionDeclaration":
        this.addFunctionSymbol(node, ast, context, symbols);
        this.visitChildren(node, ast, { ...context, scopeId: createLexicalScopeId(node.type, node.location) }, symbols);
        return;
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        this.visitChildren(node, ast, { ...context, scopeId: createLexicalScopeId(node.type, node.location) }, symbols);
        return;
      case "ClassDeclaration": {
        const className = getName(node) ?? "anonymous-class";
        const classSymbol = this.createSymbol("class", className, node, ast, context);
        symbols.push(classSymbol);
        this.visitChildren(node, ast, { ...context, containerName: className, containerId: classSymbol.id }, symbols);
        return;
      }
      case "ClassMethod":
      case "ClassPrivateMethod":
        this.addMethodSymbol(node, ast, context, symbols);
        this.visitChildren(node, ast, { ...context, scopeId: createLexicalScopeId(node.type, node.location) }, symbols);
        return;
      case "ObjectMethod":
        this.addMethodSymbol(node, ast, context, symbols);
        this.visitChildren(node, ast, { ...context, scopeId: createLexicalScopeId(node.type, node.location) }, symbols);
        return;
      default:
        break;
    }

    this.visitChildren(node, ast, context, symbols);
  }

  private visitChildren(
    node: ASTNode,
    ast: ASTResult,
    context: ExtractionContext,
    symbols: CodeSymbol[],
  ): void {
    for (const child of node.children) {
      this.visit(child, ast, context, symbols);
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

    for (const declarator of node.children.filter(
      (child) => child.role === "declarations" && child.type === "VariableDeclarator",
    )) {
      const name = getName(declarator);
      const initializer = declarator.children.find((child) => child.role === "init");
      const binding = declarator.children.find((child) => child.role === "id");

      if (name !== undefined) {
        const value = readLiteralInitializer(declarator);
        symbols.push(
          this.createSymbol("variable", name, declarator, ast, context, {
            declarationKind,
            ...(value === undefined ? {} : { value }),
          }),
        );
        if (initializer !== undefined && isAssignedFunction(initializer)) {
          symbols.push(this.createSymbol("function", name, initializer, ast, context, {
            parameters: getParameters(initializer),
            anonymous: false,
          }));
        }
      }
      const required = requireSpecifier(initializer);
      if (required !== undefined) {
        if (binding?.type === "ObjectPattern") {
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
            const importedNames = bindingNames(binding);
            for (const importedName of importedNames) {
              symbols.push(this.createSymbol("import", importedName, declarator, ast, initialContext, {
                moduleSpecifier: required,
                sourceSymbolName: importedName,
                defaultExport: false,
              }));
            }
          }
        } else {
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

  private addExportSymbol(node: ASTNode, ast: ASTResult, defaultExport: boolean, symbols: CodeSymbol[]): void {
    const moduleSpecifier = findModuleSpecifier(node);
    const specifiers = node.children.filter((child) =>
      child.role === "specifiers" && (child.type === "ExportSpecifier" || child.type === "ExportNamespaceSpecifier"),
    );

    if (specifiers.length === 0) {
      const names = defaultExport ? ["default"] : findDeclaredNames(node);
      for (const name of names) {
        this.addExport(node, ast, name, defaultExport, moduleSpecifier, undefined, symbols);
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

  private addCommonJsExport(node: ASTNode, ast: ASTResult, symbols: CodeSymbol[]): void {
    const left = node.children.find((child) => child.role === "left");
    const right = node.children.find((child) => child.role === "right");
    const target = memberPath(left);
    if (target !== "module.exports" && !target?.startsWith("module.exports.") && !target?.startsWith("exports.")) return;
    const name = target === "module.exports" ? "default" : target.split(".").at(-1);
    if (name === undefined || name.length === 0) return;
    this.addExport(node, ast, name, name === "default", undefined, identifierName(right), symbols);
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
    const position = location === undefined ? "unknown" : `${location.start.line}:${location.start.column}`;

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
  return readIdentifierName(node.children.find((child) => child.role === "id"))
    ?? readIdentifierName(node.children.find((child) => child.role === "key"))
    ?? readIdentifierName(node.children.find((child) => child.type === "Identifier"));
}

function getParameters(node: ASTNode): readonly string[] {
  return node.children
    .filter((child) => child.role === "params")
    .flatMap((child) => findParameterNames(child));
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
      .flatMap((child) => getName(child) === undefined ? [] : [getName(child) as string]);
  }

  const name = getName(declaration);
  return name === undefined ? [] : [name];
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

function findParameterNames(node: ASTNode): readonly string[] {
  if (node.type === "Identifier") {
    const name = readIdentifierName(node);
    return name === undefined ? [] : [name];
  }

  return node.children.flatMap(findParameterNames);
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
