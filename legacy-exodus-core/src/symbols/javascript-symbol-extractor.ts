import { createHash } from "node:crypto";

import { validateASTResult, type ASTNode, type ASTResult } from "@parser/index";

import type { SymbolExtractor } from "./symbol-extractor";
import {
  validateSymbolTable,
  type CodeSymbol,
  type SymbolKind,
  type SymbolSummary,
  type SymbolTable,
} from "./symbol-contracts";
import { UnsupportedSymbolLanguageError } from "./symbol-errors";

interface ExtractionContext {
  readonly exported: boolean;
  readonly defaultExport: boolean;
  readonly containerName?: string;
}

const initialContext: ExtractionContext = Object.freeze({
  exported: false,
  defaultExport: false,
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
        symbols.push(this.createSymbol("export", "*", node, ast, { exported: true, defaultExport: false }, {
          moduleSpecifier: findModuleSpecifier(node),
        }));
        return;
      case "ImportDeclaration":
        this.addImportSymbols(node, ast, symbols);
        return;
      case "VariableDeclaration":
        this.addVariableSymbols(node, ast, context, symbols);
        break;
      case "FunctionDeclaration":
        this.addFunctionSymbol(node, ast, context, symbols);
        break;
      case "ClassDeclaration": {
        const className = getName(node) ?? "anonymous-class";
        symbols.push(this.createSymbol("class", className, node, ast, context));
        this.visitChildren(node, ast, { ...context, containerName: className }, symbols);
        return;
      }
      case "ClassMethod":
      case "ClassPrivateMethod":
        this.addMethodSymbol(node, ast, context, symbols);
        break;
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
      symbols.push(
        this.createSymbol("import", readStringAttribute(specifier, "importedName") ?? getName(specifier) ?? moduleSpecifier, specifier, ast, initialContext, {
          moduleSpecifier,
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

      if (name !== undefined) {
        const value = readLiteralInitializer(declarator);
        symbols.push(
          this.createSymbol("variable", name, declarator, ast, context, {
            declarationKind,
            ...(value === undefined ? {} : { value }),
          }),
        );
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
      this.addExport(
        node,
        ast,
        defaultExport ? "default" : findDeclaredName(node) ?? "default",
        defaultExport,
        moduleSpecifier,
        undefined,
        symbols,
      );
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
      this.addExport(node, ast, defaultExport ? "default" : exportedName, defaultExport, moduleSpecifier, sourceSymbolName, symbols);
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
        exported: true,
        defaultExport,
      }, {
        ...(moduleSpecifier === undefined ? {} : { moduleSpecifier }),
        ...(sourceSymbolName === undefined ? {} : { sourceSymbolName }),
      }),
    );
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

function findDeclaredName(node: ASTNode): string | undefined {
  const declaration = node.children.find((child) =>
    child.role === "declaration" &&
    ["ClassDeclaration", "FunctionDeclaration", "VariableDeclaration"].includes(child.type),
  );

  return declaration === undefined ? getName(node) : getName(declaration) ?? findDeclaredName(declaration);
}

function findStringLiteral(node: ASTNode): string | undefined {
  if (node.type === "StringLiteral" && typeof node.attributes.value === "string") {
    return node.attributes.value;
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
  if (typeof sourceAttribute === "string") {
    return sourceAttribute;
  }

  const source = node.children.find((child) => child.role === "source");
  const sourceValue = source?.attributes.value;
  if (typeof sourceValue === "string") {
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
  const value = node.attributes[key];
  return typeof value === "string" ? value : undefined;
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
