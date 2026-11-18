import { createHash } from "node:crypto";
import type { ASTNode, ASTResult } from "@parser/index";
import { canonicalizePath, ModuleResolver, type DependencyGraph } from "@graph/index";
import type { SymbolTable } from "@symbols/index";
import { createLexicalScopeId, FactKeyer, type CodeSymbol } from "@symbols/index";
import type { SemanticCall, SymbolReference, UnresolvedReason } from "./semantic-contracts";
import { ClassHierarchy, collectClassHierarchyFacts } from "./class-hierarchy";
import { collectFactoryFacts, FactoryIndex } from "./factory-objects";
import { collectLoadTimeModuleFacts, requireCycleFacts } from "./require-cycles";
import { stableId } from "@shared/identity";
import { compareCodePoints } from "@shared/ordering";
import { immutable } from "@shared/immutability";
import { MODULE_SCOPE_ID, type ScopeFrame, bindingWriteKey, classElementName, comparePoints, createScope, createsScope, declarationAnchor, extractBoundNames, extractStaticString, frameFor, identifier, isCallable, lexicalBindingKey, memberPathOf, memberPropertyName, nodeName, propertyKeyName, staticPropertyKey } from "./scope-model";
import type { ClassFacts, ClassMemberFact, FileSymbolIndex, ResolutionContext, ThisClass, WriteSite } from "./call-graph-types";
import { classFieldTypes, collectBindingWrites } from "./binding-writes";
import { commonJsInitializerSpecifier, createLexicalBindingIndex, mayBelongToOtherBlock, resolveLexicalBinding } from "./lexical-bindings";
import { assignedValue, bindingKey, declaredBindingFrame, isLexicallyShadowed, isRebound, isUnboundName, propertyWriteCount, receiverKey, visibleImport } from "./binding-queries";
import { bindingDeclarations, callsEvalDirectly, collectForeignExportWrites, collectGlobalWrites, collectUnstableExportIds, foreignExportWriteTargets, packageWriteKeys, wrapperGlobalWrites } from "./run-wide-writes";
import { externalTarget, factoryExternalTarget, globalPathUnwritten, globalTarget, isRepositoryImport, repositoryPackageImports, resolvedCallTargets, valueTarget } from "./external-targets";

export class DeterministicCallGraphBuilder {
  /** Package members some file of the run writes (`module\u0000member`, `*` for a computed one): never EXTERNAL (ADR-012). */
  private packageWrites: ReadonlySet<string> = new Set();
  /** RT-M9: per file, the imports whose module is in the file's own require cycle, and whether each is stale (see requireCycleFacts). */
  private cycleImports: ReadonlyMap<string, ReadonlyMap<string, boolean>> = new Map();
  /** Standard-global paths some file of the run writes (`console.log`, `JSON`, `process.*`): never EXTERNAL (ADR-012). */
  private globalWrites: ReadonlySet<string> = new Set();
  /** TypeScript files whose `import` syntax compiles to `require` (B2): `require` is the wrapper's own there too. */
  private compiledCommonJs: ReadonlySet<string> = new Set();

  /** @param resolver - the run's resolver (tsconfig aliases, workspace packages), shared with the dependency graph. */
  public constructor(public readonly resolver: ModuleResolver = new ModuleResolver()) {}

  /** The package members the run's files write (see packageWriteKeys); set before any file is built. */
  public usePackageWrites(keys: ReadonlySet<string>): void {
    this.packageWrites = keys;
  }

  /** The standard-global paths the run's files write (see collectGlobalWrites); set before any file is built. */
  public useGlobalWrites(paths: ReadonlySet<string>): void {
    this.globalWrites = paths;
  }

  /** RT-M9: per file, the imports whose module is in its own require cycle (see requireCycleFacts); set before any file is built. */
  public useCycleImports(imports: ReadonlyMap<string, ReadonlyMap<string, boolean>>): void {
    this.cycleImports = imports;
  }

  /** TypeScript files compiled to CommonJS (see loadCompiledCommonJsFiles); set before any file is built. */
  public useCompiledCommonJs(paths: ReadonlySet<string>): void {
    this.compiledCommonJs = paths;
  }

  public build(astResults: readonly ASTResult[], symbolTables: readonly SymbolTable[], dependencyGraph: DependencyGraph): { readonly calls: readonly SemanticCall[]; readonly references: readonly SymbolReference[] } {
    const tablesByPath = new Map(symbolTables.map((table) => [canonicalizePath(table.filePath), table]));
    const importsByFile = new Map<string, readonly { readonly id: string; readonly name: string }[]>();
    const targetByImportId = new Map(dependencyGraph.edges.map((edge) => [edge.importSymbolId, edge.targetExportSymbolId]));
    const unstableExportIds = new Set(astResults.flatMap((ast) => collectUnstableExportIds(ast, tablesByPath.get(canonicalizePath(ast.metadata.sourcePath)))));
    // An export another file writes (`require("./hooks").run = stub`) can change after definition too (OR-01).
    const knownPaths = new Set(tablesByPath.keys());
    const writes = astResults.flatMap((ast) => collectForeignExportWrites(ast, tablesByPath.get(canonicalizePath(ast.metadata.sourcePath))));
    for (const id of foreignExportWriteTargets(writes, (importer, specifier) => this.resolver.resolve(importer, specifier, knownPaths).resolvedPath ?? undefined, (path) => tablesByPath.get(path)?.symbols ?? [])) unstableExportIds.add(id);
    this.usePackageWrites(packageWriteKeys(writes, (importer, specifier) => this.resolver.resolve(importer, specifier, knownPaths).resolvedPath ?? undefined));
    this.useGlobalWrites(new Set(astResults.flatMap((ast) => collectGlobalWrites(ast))));
    const importTargetFile = new Map(dependencyGraph.edges.map((edge) => [edge.importSymbolId, edge.targetFilePath]));
    // RT-M9: require cycles (see require-cycles.ts).
    const cycleFacts = requireCycleFacts(
      astResults.map((ast) => collectLoadTimeModuleFacts(ast)),
      (importer, specifier) => { const resolved = this.resolver.resolve(importer, specifier, knownPaths).resolvedPath; return resolved === null ? undefined : canonicalizePath(resolved); },
      (filePath) => tablesByPath.get(filePath)?.symbols ?? [],
    );
    this.useCycleImports(cycleFacts.cycleImports);
    const hierarchy = new ClassHierarchy(
      astResults.map((ast) => collectClassHierarchyFacts(ast, tablesByPath.get(canonicalizePath(ast.metadata.sourcePath)))),
      (importId) => importTargetFile.get(importId),
    );
    const factories = new FactoryIndex(
      astResults.map((ast) => collectFactoryFacts(ast, tablesByPath.get(canonicalizePath(ast.metadata.sourcePath)))),
      (name, filePath) => hierarchy.isWrittenOutside(name, filePath),
      (importer, specifier) => { const resolved = this.resolver.resolve(importer, specifier, knownPaths).resolvedPath; return resolved === null ? undefined : canonicalizePath(resolved); },
    );
    const calls: SemanticCall[] = [];
    const references: SymbolReference[] = [];

    for (const ast of [...astResults].sort((left, right) => compareCodePoints(left.metadata.sourcePath, right.metadata.sourcePath))) {
      this.buildForFile(ast, tablesByPath, importsByFile, targetByImportId, unstableExportIds, calls, references, hierarchy, factories);
    }

    return immutable({ calls: immutable(calls), references: immutable(references) });
  }

  /**
   * @param unstableExportIds - Export symbols of every analyzed module whose value can change
   *   after definition (see collectUnstableExportIds); imports resolving to them stay UNRESOLVED.
   * @param hierarchy - The repository's class hierarchy and borrowed method names (see class-hierarchy.ts). Without
   *   it, public `this.m()` calls stay UNRESOLVED.
   */
  public buildForFile(
    ast: ASTResult,
    tablesByPath: ReadonlyMap<string, SymbolTable>,
    importsByFile: ReadonlyMap<string, readonly { readonly id: string; readonly name: string }[]>,
    targetByImportId: ReadonlyMap<string, string>,
    unstableExportIds: ReadonlySet<string>,
    calls: SemanticCall[],
    references: SymbolReference[],
    hierarchy?: ClassHierarchy,
    factories?: FactoryIndex,
  ): void {
    const initialContext: ResolutionContext = {
      callerName: "module",
      scope: createScope("scope:module"),
      receiverTypes: new Map(),
      constantBindings: new Map(),
      ...(hierarchy === undefined ? {} : { hierarchy }),
      ...(factories === undefined ? {} : { factories }),
      globalWrites: new Set([...this.globalWrites, ...wrapperGlobalWrites(this.packageWrites)]),
    };
    predeclareScopeBindings(ast.root, initialContext);
    const boundCallees = new Set<ASTNode>();
    const table = tablesByPath.get(canonicalizePath(ast.metadata.sourcePath));
    const fileSymbols = createFileSymbolIndex(table, ast, unstableExportIds, this.cycleImports.get(canonicalizePath(ast.metadata.sourcePath)) ?? new Map());
    // `require` is the module wrapper's own binding only in CommonJS: never in .mjs/.mts; never in another file than
    // .cjs/.cts whose nearest package.json says `"type": "module"`, which Node runs as an ES module, compiled or not
    // (RT-L5); and not in a file with ESM syntax unless the compiler turns that file into CommonJS (B2).
    const sourcePath = canonicalizePath(ast.metadata.sourcePath);
    commonJsFiles.set(fileSymbols, !/\.m[jt]s$/i.test(sourcePath)
      && (/\.c[jt]s$/i.test(sourcePath) || this.resolver.packageType(sourcePath) !== "module")
      && (this.compiledCommonJs.has(sourcePath) || !(table?.moduleReferences ?? []).some((reference) => reference.form.startsWith("esm"))));
    repositoryPackageImports.set(fileSymbols, (specifier) => this.resolver.namesRepositoryPackage(sourcePath, specifier));
    factKeyers.set(fileSymbols, new FactKeyer(ast.metadata.sourcePath, ast.root, fileSymbols.ownerSymbols));
    this.visit(ast.root, ast, initialContext, tablesByPath, importsByFile, targetByImportId, calls, references, boundCallees, fileSymbols, undefined, false);
  }

  private visit(
    node: ASTNode,
    ast: ASTResult,
    context: ResolutionContext,
    tablesByPath: ReadonlyMap<string, SymbolTable>,
    importsByFile: ReadonlyMap<string, readonly { readonly id: string; readonly name: string }[]>,
    targetByImportId: ReadonlyMap<string, string>,
    calls: SemanticCall[],
    references: SymbolReference[],
    boundCallees: Set<ASTNode>,
    fileSymbols: FileSymbolIndex,
    parent: ASTNode | undefined,
    bindingPosition: boolean,
  ): void {
    const canonicalSourcePath = canonicalizePath(ast.metadata.sourcePath);
    const table = tablesByPath.get(canonicalSourcePath);
    const nextContext = childContext(node, context, fileSymbols);
    if (nextContext.scope !== context.scope) {
      predeclareScopeBindings(node, nextContext);
    }
    if (isCallable(node) || node.type === "CatchClause") {
      recordParamReceiverTypes(node, nextContext);
      recordParamConstantBindings(node, nextContext);
    }
    if (node.type === "VariableDeclarator") {
      recordReceiverType(node, nextContext, fileSymbols);
      recordConstantBinding(node, nextContext, fileSymbols);
    }
    if (node.type === "AssignmentExpression") {
      recordAssignmentReceiverType(node, nextContext, fileSymbols);
      recordAssignmentConstantBinding(node, nextContext, fileSymbols);
    }
    if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") {
      const declName = nodeName(node);
      if (declName !== undefined) {
        (nextContext.receiverTypes as Map<string, string | null>).set(receiverKey(context.scope, declName), null);
        (nextContext.constantBindings as Map<string, string | null>).set(bindingKey(context.scope, declName), null);
      }
    }
    if (node.type === "CallExpression" || node.type === "OptionalCallExpression" || node.type === "NewExpression" || node.type === "TaggedTemplateExpression") {
      if (!boundCallees.has(node)) {
        const namedCallee = callName(node, nextContext, boundCallees);
        // A callee no name denotes is still a call site: an explicit UNRESOLVED fact, never left out (NA-01).
        const calleeName = namedCallee ?? unnamedCalleeName(node, nextContext);
        const isShadowed = namedCallee === undefined || isLexicallyShadowed(calleeName, nextContext, fileSymbols);
        // A `require` inside a function declares its binding there, which counts as shadowing; the import
        // still names the callee when the binding the call sees is that import and is never rebound.
        const imported = namedCallee === undefined
          ? undefined
          : isShadowed ? scopedImport(fileSymbols, calleeName, nextContext.scope) : visibleImport(fileSymbols, calleeName, nextContext.scope);
        const importTarget = imported === undefined ? undefined : targetByImportId.get(imported.id);
        // `f.call(…)`, `f.apply(…)` and `f.bind(…)(…)` are resolved as `f`; that holds only while those properties are the builtins.
        const invokesThroughWrittenProperty = invokerProperties(node).some((name) => propertyWriteCount(fileSymbols, name) > 0);
        const evalOrWith = namedCallee !== undefined && (fileSymbols.directEval || withMayBind(calleeName, nextContext, fileSymbols));
        const resolvedTarget = namedCallee === undefined || invokesThroughWrittenProperty || evalOrWith
          ? undefined
          : imported === undefined
            ? resolveLocalCall(table, fileSymbols, calleeName, nextContext, tablesByPath, this.resolver, node)
            : isRebound(fileSymbols, MODULE_SCOPE_ID, calleeName) || isUnstableTarget(fileSymbols, importTarget) || holdsStaleExports(fileSymbols, imported) || loadsDuringCycle(fileSymbols, imported, nextContext) ? undefined : importTarget;
        // RT-M9: a load-time member call on an import of a module in this file's require cycle (`a.run()`), whichever
        // rule found its target, may run while that module is still loading.
        const receiverImport = imported === undefined && namedCallee !== undefined && calleeName.includes(".")
          ? visibleImport(fileSymbols, calleeName.slice(0, calleeName.indexOf(".")), nextContext.scope)
          : undefined;
        const runsTooEarly = imported === undefined
          ? runsBeforeAssignment(resolvedTarget, node, nextContext, fileSymbols, ast.root) || (receiverImport !== undefined && loadsDuringCycle(fileSymbols, receiverImport, nextContext))
          : callsBeforeRequire(fileSymbols, imported, node);
        const targetSymbolId = runsTooEarly ? undefined : resolvedTarget;
        const id = hash(`${ast.metadata.sourcePath}:${nextContext.callerName}:${calleeName}:${node.location?.start.line ?? 0}:${node.location?.start.column ?? 0}`);
        // A call proven to leave the repository: a stable import of a package or Node module, never replaced here (ADR-012).
        const external = targetSymbolId !== undefined || namedCallee === undefined || evalOrWith || invokesThroughWrittenProperty || (resolvedTarget !== undefined && runsTooEarly)
          ? undefined
          : externalTarget(imported, calleeName, fileSymbols, nextContext, this.packageWrites)
            ?? globalTarget(calleeName, fileSymbols, nextContext, nextContext.globalWrites ?? this.globalWrites, commonJsFiles.get(fileSymbols) === true)
            ?? valueTarget(calleeName, fileSymbols, nextContext, nextContext.globalWrites ?? this.globalWrites)
            ?? factoryExternalTarget(calleeName, fileSymbols, nextContext);
        const resolutionState = targetSymbolId !== undefined ? "RESOLVED" as const : external !== undefined ? "EXTERNAL" as const : "UNRESOLVED" as const;
        if (targetSymbolId !== undefined) {
          const resolved = resolvedCallTargets.get(fileSymbols) ?? new Map<ASTNode, string>();
          resolved.set(node, targetSymbolId);
          resolvedCallTargets.set(fileSymbols, resolved);
        }
        const reason = resolutionState !== "UNRESOLVED" ? undefined : unresolvedReason({
          named: namedCallee !== undefined, evalOrWith, invokerWritten: invokesThroughWrittenProperty,
          runsTooEarly: resolvedTarget !== undefined && runsTooEarly, imported, importTarget, calleeName, index: fileSymbols, context: nextContext,
        });
        const key = factKeyers.get(fileSymbols)?.key("call", calleeName, node.location?.start);
        const keyed = key === undefined ? {} : { key };
        const callId = key === undefined ? id : stableId("call", key);
        const reference: SymbolReference = { id: key === undefined ? hash(`reference:${id}`) : stableId("call-reference", key), ...keyed, filePath: ast.metadata.sourcePath, name: calleeName, kind: "call", resolutionState, ...(targetSymbolId === undefined ? {} : { resolvedSymbolId: targetSymbolId }) };
        references.push(reference);
        calls.push({ id: callId, ...keyed, sourceFilePath: ast.metadata.sourcePath, callerName: nextContext.callerName, calleeName, resolutionState, ...(targetSymbolId === undefined ? {} : { targetSymbolId }), ...(external === undefined ? {} : { external }), ...(reason === undefined ? {} : { reason }), ...(node.location === undefined ? {} : { location: node.location.start }) });
      }
    }

    if (!bindingPosition && isLexicalReference(node, parent)) {
      const name = identifier(node);
      const binding = name === undefined ? undefined : resolveLexicalBinding(fileSymbols, name, nextContext.scope);
      if (name !== undefined && binding?.state === "ONE_BINDING") {
        const location = node.location?.start;
        const key = factKeyers.get(fileSymbols)?.key("ref", name, location);
        for (const [index, target] of binding.referenceTargets.entries()) {
          const referenceKey = key === undefined ? undefined : binding.referenceTargets.length > 1 ? `${key}/${index}` : key;
          references.push({
            id: referenceKey === undefined ? hash(`identifier-reference:${ast.metadata.sourcePath}:${target.id}:${location?.line ?? 0}:${location?.column ?? 0}`) : stableId("reference", referenceKey),
            ...(referenceKey === undefined ? {} : { key: referenceKey }),
            filePath: ast.metadata.sourcePath,
            name,
            kind: "identifier",
            resolutionState: "RESOLVED",
            resolvedSymbolId: target.id,
          });
        }
      }
    }

    // Under the classic JSX runtime, JSX compiles to `React.createElement`, so an element or fragment
    // uses the visible `React` binding. Which runtime a project uses is not known here; the binding is
    // never claimed unused in a file that needs it under either (BA-24).
    if (node.type === "JSXElement" || node.type === "JSXFragment") {
      const binding = resolveLexicalBinding(fileSymbols, "React", nextContext.scope);
      if (binding.state === "ONE_BINDING") {
        const location = node.location?.start;
        const key = factKeyers.get(fileSymbols)?.key("jsx", "React", location);
        for (const [index, target] of binding.referenceTargets.entries()) {
          const referenceKey = key === undefined ? undefined : binding.referenceTargets.length > 1 ? `${key}/${index}` : key;
          references.push({
            id: referenceKey === undefined ? hash(`jsx-reference:${ast.metadata.sourcePath}:${target.id}:${location?.line ?? 0}:${location?.column ?? 0}`) : stableId("reference", referenceKey),
            ...(referenceKey === undefined ? {} : { key: referenceKey }),
            filePath: ast.metadata.sourcePath,
            name: "React",
            kind: "identifier",
            resolutionState: "RESOLVED",
            resolvedSymbolId: target.id,
          });
        }
      }
    }

    const withBodyContext = node.type === "WithStatement" ? { ...nextContext, withOuter: nextContext.scope } : undefined;
    for (const child of node.children) {
      this.visit(
        child,
        ast,
        withBodyContext !== undefined && child.role === "body" ? withBodyContext : nextContext,
        tablesByPath,
        importsByFile,
        targetByImportId,
        calls,
        references,
        boundCallees,
        fileSymbols,
        node,
        isBindingPosition(node, child, bindingPosition),
      );
    }
  }
}

function createFileSymbolIndex(table: SymbolTable | undefined, ast: ASTResult, unstableExportIds: ReadonlySet<string>, cycleImports: ReadonlyMap<string, boolean>): FileSymbolIndex {
  const byScopeAndName = new Map<string, CodeSymbol[]>();
  const byName = new Map<string, CodeSymbol[]>();
  const firstImportByName = new Map<string, CodeSymbol>();
  const classByLocation = new Map<string, CodeSymbol>();
  const byAnchor = new Map<string, CodeSymbol[]>();
  const classSymbols: CodeSymbol[] = [];
  const ownerSymbols: CodeSymbol[] = [];

  const namespaceBlocks: NamespaceBlocks = new Map();

  const moduleImports: CodeSymbol[] = [];

  for (const symbol of table?.symbols ?? []) {
    noteNamespaceMember(namespaceBlocks, symbol);
    const anchor = declarationAnchor(symbol.location);
    if (anchor !== undefined && canonicalizePath(symbol.filePath) === canonicalizePath(ast.metadata.sourcePath)) {
      const anchored = byAnchor.get(anchor) ?? [];
      anchored.push(symbol);
      byAnchor.set(anchor, anchored);
    }
    const namedCandidates = byName.get(symbol.name) ?? [];
    namedCandidates.push(symbol);
    byName.set(symbol.name, namedCandidates);
    if (symbol.kind === "import" && symbol.scopeId === MODULE_SCOPE_ID) moduleImports.push(symbol);

    if (symbol.scopeId !== undefined) {
      const key = lexicalBindingKey(symbol.scopeId, symbol.name);
      const scopedCandidates = byScopeAndName.get(key) ?? [];
      scopedCandidates.push(symbol);
      byScopeAndName.set(key, scopedCandidates);
    }

    if (symbol.kind === "import" && !firstImportByName.has(symbol.name)) {
      firstImportByName.set(symbol.name, symbol);
    }

    if (symbol.kind === "function" || symbol.kind === "method" || symbol.kind === "class") ownerSymbols.push(symbol);
    if (symbol.kind === "class" && symbol.location !== undefined) {
      classSymbols.push(symbol);
      const key = symbolLocationKey(symbol.location.start.line, symbol.location.start.column);
      if (!classByLocation.has(key)) {
        classByLocation.set(key, symbol);
      }
    }
  }

  // A `require` inside a function binds in that function, though the symbol table files it as a module import.
  const requireScopes = moduleImports.length === 0 ? new Map<string, string>() : functionLevelRequireScopes(ast, table, byAnchor);
  for (const symbol of moduleImports) {
    const scopeId = requireScopes.get(symbol.id);
    if (scopeId === undefined) continue;
    const moduleKey = lexicalBindingKey(MODULE_SCOPE_ID, symbol.name);
    const remaining = (byScopeAndName.get(moduleKey) ?? []).filter((candidate) => candidate.id !== symbol.id);
    if (remaining.length === 0) byScopeAndName.delete(moduleKey);
    else byScopeAndName.set(moduleKey, remaining);
    const scopedKey = lexicalBindingKey(scopeId, symbol.name);
    byScopeAndName.set(scopedKey, [...(byScopeAndName.get(scopedKey) ?? []), symbol]);
  }

  const lexicalBindings = createLexicalBindingIndex(ast, table, byAnchor, byScopeAndName);
  const declarationsByScopeAndName = bindingDeclarations(byScopeAndName, ast.root);
  const writes = collectBindingWrites(ast.root, declarationsByScopeAndName);
  const classes = collectClassFacts(ast.root, classSymbols);
  const reopened = reopenedNamespaces(namespaceBlocks);
  return immutable({ byScopeAndName, declarationsByScopeAndName, byName, firstImportByName, classByLocation, lexicalBindings, ownerSymbols, reopened, writes, unstableExportIds, cycleImports, classes, directEval: callsEvalDirectly(ast.root) });
}

/**
 * `f(); var f = function () {}` (NA-12): the call runs before the function is assigned, so at that point `f` is
 * `undefined` (or in its temporal dead zone) and nothing is proven. It holds when the target lies after the call in the
 * source, is not a hoisted function declaration, and no function boundary lies between the call and the target's
 * scope (a closure may run later). A call in a loop is treated the same way, which only gives up a proof.
 */
function runsBeforeAssignment(targetSymbolId: string | undefined, call: ASTNode, context: ResolutionContext, index: FileSymbolIndex, root: ASTNode): boolean {
  const at = call.location?.start;
  if (targetSymbolId === undefined || at === undefined) return false;
  const target = symbolsById(index).get(targetSymbolId);
  const starts = target?.location?.start;
  // Methods exist as soon as their class does, so only statement-order bindings can be called too early.
  if (target === undefined || starts === undefined || target.scopeId === undefined || !ORDERED_KINDS.has(target.kind)) return false;
  if (starts.line < at.line || (starts.line === at.line && starts.column <= at.column)) return false;
  if (hoistedDeclarationStarts(root).has(`${starts.line}:${starts.column}`)) return false;
  for (let frame: ScopeFrame | undefined = context.scope; frame !== undefined; frame = frame.parent) {
    if (frame.id === target.scopeId) return true;
    if (FUNCTION_FRAME.test(frame.id)) return false;
  }
  return false;
}

const symbolsByIdByIndex = new WeakMap<FileSymbolIndex, ReadonlyMap<string, CodeSymbol>>();

/** The file's symbols by id, built once per file. */
function symbolsById(index: FileSymbolIndex): ReadonlyMap<string, CodeSymbol> {
  let byId = symbolsByIdByIndex.get(index);
  if (byId === undefined) {
    byId = new Map([...index.byName.values()].flat().map((symbol) => [symbol.id, symbol] as const));
    symbolsByIdByIndex.set(index, byId);
  }
  return byId;
}

const ORDERED_KINDS: ReadonlySet<CodeSymbol["kind"]> = new Set(["variable", "class", "function"]);
const FUNCTION_FRAME = /^scope:(?:Function|ArrowFunction|ObjectMethod|ClassMethod|ClassPrivateMethod)/;
const hoistedStartsByRoot = new WeakMap<ASTNode, ReadonlySet<string>>();

/** Start positions of function declarations and their names, which are callable before their position (hoisted). */
function hoistedDeclarationStarts(root: ASTNode): ReadonlySet<string> {
  const cached = hoistedStartsByRoot.get(root);
  if (cached !== undefined) return cached;
  const starts = new Set<string>();
  const pending: ASTNode[] = [root];
  while (pending.length > 0) {
    const node = pending.pop() as ASTNode;
    if (node.type === "FunctionDeclaration") {
      for (const at of [node.location?.start, node.children.find((child) => child.role === "id")?.location?.start]) if (at !== undefined) starts.add(`${at.line}:${at.column}`);
    }
    for (const child of node.children) pending.push(child);
  }
  hoistedStartsByRoot.set(root, starts);
  return starts;
}

/** Fact keys (ADR-008 step 2) per file, keyed by the file's symbol index for the duration of its visit. */
const factKeyers = new WeakMap<FileSymbolIndex, FactKeyer>();

const NAMESPACE_BLOCK = "scope:TSModuleDeclaration:";

/** Members by namespace path (`containerName`) and block scope: the blocks of one namespace share a path. */
type NamespaceBlocks = Map<string, Map<string, Set<string>>>;

function noteNamespaceMember(blocks: NamespaceBlocks, symbol: CodeSymbol): void {
  if (symbol.scopeId === undefined || !symbol.scopeId.startsWith(NAMESPACE_BLOCK) || symbol.containerName === undefined) return;
  const group = blocks.get(symbol.containerName) ?? new Map<string, Set<string>>();
  const names = group.get(symbol.scopeId) ?? new Set<string>();
  names.add(symbol.name);
  group.set(symbol.scopeId, names);
  blocks.set(symbol.containerName, group);
}

function reopenedNamespaces(blocks: NamespaceBlocks): ReadonlyMap<string, ReadonlySet<string>> {
  const reopened = new Map<string, ReadonlySet<string>>();
  for (const group of blocks.values()) {
    if (group.size < 2) continue;
    for (const scopeId of group.keys()) {
      reopened.set(scopeId, new Set([...group].filter(([other]) => other !== scopeId).flatMap(([, names]) => [...names])));
    }
  }
  return reopened;
}

function collectClassFacts(root: ASTNode, symbols: readonly CodeSymbol[]): ClassFacts {
  const classNodes = new Map<string, ASTNode>();
  const members = new Map<string, ClassMemberFact>();
  const isDecorated = (node: ASTNode): boolean => node.children.some((child) => child.role === "decorators");
  const visit = (node: ASTNode): void => {
    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      const anchor = declarationAnchor(node.location);
      if (anchor !== undefined) classNodes.set(anchor, node);
      for (const element of node.children.find((child) => child.type === "ClassBody")?.children ?? []) {
        const elementAnchor = declarationAnchor(element.location);
        if (elementAnchor === undefined) continue;
        if (element.type === "ClassMethod" || element.type === "ClassPrivateMethod") {
          members.set(elementAnchor, { classNode: node, isStatic: element.attributes.static === true, kind: String(element.attributes.kind ?? "method"), decorated: isDecorated(element) });
        } else if (classFieldTypes.has(element.type)) {
          const value = element.children.find((child) => child.role === "value");
          if (value?.type === "ArrowFunctionExpression" || value?.type === "FunctionExpression") {
            members.set(elementAnchor, { classNode: node, isStatic: element.attributes.static === true, kind: "field", decorated: isDecorated(element) });
          }
        }
      }
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  const nodes = new Map<string, ASTNode>();
  const decorated = new Set<string>();
  for (const symbol of symbols) {
    const node = symbol.kind === "class" ? classNodes.get(declarationAnchor(symbol.location) ?? "") : undefined;
    if (node === undefined) continue;
    nodes.set(symbol.id, node);
    if (isDecorated(node)) decorated.add(symbol.id);
  }
  return immutable({ nodes, decorated, members });
}

/**
 * Whether `method` is a plain method, or a field initialized with a function, declared in the
 * body of class `classId`: not a getter or setter, not decorated in a class no decorator
 * replaces, and static or not as `isStatic` asks.
 */
function isClassBodyMethod(index: FileSymbolIndex, method: CodeSymbol, classId: string, isStatic: boolean | undefined): boolean {
  const classNode = index.classes.nodes.get(classId);
  const fact = index.classes.members.get(declarationAnchor(method.location) ?? "");
  return classNode !== undefined && fact !== undefined && fact.classNode === classNode && (fact.kind === "method" || fact.kind === "field") && !fact.decorated
    && !index.classes.decorated.has(classId) && (isStatic === undefined || fact.isStatic === isStatic)
    && soleBodyElement(classNode, method.name, fact.isStatic);
}

/**
 * RT-L6: whether the class body gives `name` exactly one element of that staticness. A later getter, setter, field or
 * method of the same name replaces an earlier method (`m() {…} get m() {…}`). Type-only members (overload signatures,
 * `declare` fields) define nothing at run time and are not counted; a computed key is assumed not to produce `name`.
 */
function soleBodyElement(classNode: ASTNode, name: string, isStatic: boolean): boolean {
  const body = classNode.children.find((child) => child.type === "ClassBody");
  return (body?.children ?? []).filter((element) => element.type !== "StaticBlock" && element.type !== "TSDeclareMethod" && element.type !== "TSIndexSignature"
    && element.attributes.declare !== true && (element.attributes.static === true) === isStatic && classElementName(element) === name).length === 1;
}

/** Property writes a class member makes itself: a field writes its name once; a method none. */
function ownPropertyWrites(index: FileSymbolIndex, member: CodeSymbol): number {
  return index.classes.members.get(declarationAnchor(member.location) ?? "")?.kind === "field" ? 1 : 0;
}

/**
 * Whether `new C()` yields an instance of C: neither C nor any base class returns another
 * object from its constructor, and every base class is a class this file declares.
 */
function constructsInstance(index: FileSymbolIndex, classId: string, seen: Set<string> = new Set()): boolean {
  const node = index.classes.nodes.get(classId);
  if (node === undefined || seen.has(classId) || index.classes.decorated.has(classId)) return false;
  seen.add(classId);
  const body = node.children.find((child) => child.type === "ClassBody");
  const constructor = body?.children.find((child) => child.type === "ClassMethod" && child.attributes.kind === "constructor");
  if (constructor !== undefined && returnsValue(constructor, true)) return false;
  const superClass = node.children.find((child) => child.role === "superClass");
  if (superClass === undefined) return true;
  const superName = superClass.type === "Identifier" ? identifier(superClass) : undefined;
  const classSymbol = (index.byName.get(nodeName(node) ?? "") ?? []).find((symbol) => symbol.id === classId);
  const declaredIn = classSymbol?.scopeId === undefined ? undefined : index.writes.scopeFrames.get(classSymbol.scopeId);
  const frame = superName === undefined || declaredIn === undefined ? undefined : declaredBindingFrame(index, superName, declaredIn);
  if (superName === undefined || frame === undefined || isRebound(index, frame.id, superName)) return false;
  const declared = index.declarationsByScopeAndName.get(lexicalBindingKey(frame.id, superName)) ?? [];
  return declared.length === 1 && declared[0]?.kind === "class" && constructsInstance(index, declared[0].id, seen);
}

/** Whether a `return` with a value runs in this function's own body. */
function returnsValue(node: ASTNode, isRoot = false): boolean {
  if (!isRoot && (isCallable(node) || node.type === "ClassDeclaration" || node.type === "ClassExpression")) return false;
  if (node.type === "ReturnStatement" && node.children.some((child) => child.role === "argument")) return true;
  return node.children.some((child) => returnsValue(child));
}

/**
 * RT-M9: a load-time call through an import of a module in this file's require cycle; that module may still be loading.
 * Only a call outside every function counts. A call inside a function keeps the assumption that it runs after the
 * modules have loaded, as in runsBeforeAssignment. The caller name is no test: a top-level callback is "module" too.
 */
function loadsDuringCycle(index: FileSymbolIndex, imported: CodeSymbol, context: ResolutionContext): boolean {
  if (!index.cycleImports.has(imported.id)) return false;
  for (let frame: ScopeFrame | undefined = context.scope; frame !== undefined; frame = frame.parent) {
    if (FUNCTION_FRAME.test(frame.id)) return false;
  }
  return true;
}

/** RT-M9: an import of a file of this file's cycle that may leave it holding that file's replaced exports object. */
function holdsStaleExports(index: FileSymbolIndex, imported: CodeSymbol): boolean {
  return index.cycleImports.get(imported.id) === true;
}

function isUnstableTarget(index: FileSymbolIndex, targetSymbolId: string | undefined): boolean {
  return targetSymbolId !== undefined && index.unstableExportIds.has(targetSymbolId);
}

/**
 * Proves the class of `receiver` at a call created by `new C()`: either the binding is
 * written exactly once (a successful call can observe no other value), or every write
 * runs in the call's own execution context, the latest preceding write is unconditional
 * and constructs C, no write lies between it and the call, and no enclosing loop writes it.
 */
function provenReceiverClass(index: FileSymbolIndex, receiver: string, context: ResolutionContext, callNode: ASTNode | undefined): string | undefined {
  const site = callNode === undefined ? undefined : index.writes.callSites.get(callNode);
  const frame = declaredBindingFrame(index, receiver, context.scope);
  if (site === undefined || frame === undefined) return undefined;
  const key = bindingWriteKey(frame.id, receiver);
  const writes = index.writes.writeSites.get(key) ?? [];
  let reaching: WriteSite | undefined;
  if (writes.length === 1) {
    reaching = writes[0];
  } else {
    if (writes.length === 0 || writes.some((write) => !write.ordered) || index.writes.declaringContext.get(key) !== site.contextId) return undefined;
    if (writes.some((write) => write.contextId !== site.contextId || write.loopIds.some((loopId) => site.loopIds.includes(loopId)))) return undefined;
    for (const write of writes) {
      if (comparePoints(write.end, site.start) < 0 && (reaching === undefined || comparePoints(write.end, reaching.end) > 0)) reaching = write;
    }
    if (reaching === undefined || !reaching.unconditional) return undefined;
    const from = reaching.end;
    if (writes.some((write) => write !== reaching && comparePoints(write.start, from) > 0 && comparePoints(write.start, site.start) < 0)) return undefined;
  }

  const constructed = reaching?.constructed;
  if (constructed === undefined) return undefined;
  // `new C()` constructs whatever the nearest declaration of C holds; that must be the class itself.
  const classFrame = declaredBindingFrame(index, constructed.className, constructed.scope);
  if (classFrame === undefined || isRebound(index, classFrame.id, constructed.className)) return undefined;
  const declared = index.declarationsByScopeAndName.get(lexicalBindingKey(classFrame.id, constructed.className)) ?? [];
  return declared.length === 1 && declared[0]?.kind === "class" ? declared[0].id : undefined;
}

/**
 * The scope each CommonJS import bound by a `require` inside a function really belongs to, by import id. The
 * symbol table files every `require` as a module import; one bound by `const { f } = require("./m")` in a
 * function (no variable record of its own) exists only in that function's scope, so outside it the name is
 * unbound or another binding. Scopes follow the lexical binding walk: `var` belongs to the function.
 */
function functionLevelRequireScopes(
  ast: ASTResult,
  table: SymbolTable | undefined,
  byAnchor: ReadonlyMap<string, readonly CodeSymbol[]>,
): ReadonlyMap<string, string> {
  const scopes = new Map<string, string>();
  const commonJsImports = new Set(
    (table?.moduleReferences ?? []).filter(reference => reference.form === "commonjs-import").flatMap(reference => reference.importSymbolIds),
  );
  if (commonJsImports.size === 0) return scopes;
  const visit = (node: ASTNode, scopeId: string, functionScopeId: string, parent?: ASTNode): void => {
    const nestedScope = createsScope(node) ? createLexicalScopeId(node.type, node.location) : scopeId;
    const nestedFunctionScope = isCallable(node) || node.type === "TSModuleDeclaration" || node.type === "StaticBlock" ? nestedScope : functionScopeId;
    if (node.type === "VariableDeclarator" && parent?.type === "VariableDeclaration") {
      const declarationScope = parent.attributes.kind === "var" ? functionScopeId : scopeId;
      const specifier = commonJsInitializerSpecifier(node.children.find(child => child.role === "init"));
      const anchor = declarationAnchor(node.location);
      if (declarationScope !== "scope:module" && specifier !== undefined && anchor !== undefined) {
        const anchored = byAnchor.get(anchor) ?? [];
        for (const name of extractBoundNames(node.children.find(child => child.role === "id"))) {
          if (anchored.some(symbol => symbol.kind === "variable" && symbol.name === name)) continue;
          for (const symbol of anchored) {
            if (symbol.kind === "import" && symbol.name === name && symbol.scopeId === "scope:module"
              && commonJsImports.has(symbol.id) && symbol.moduleSpecifier === specifier) scopes.set(symbol.id, declarationScope);
          }
        }
      }
    }
    for (const child of node.children) visit(child, nestedScope, nestedFunctionScope, node);
  };
  visit(ast.root, "scope:module", "scope:module");
  return scopes;
}

function symbolLocationKey(line: number, column: number): string {
  return `${line}:${column}`;
}

function isLexicalReference(node: ASTNode, parent: ASTNode | undefined): boolean {
  if (node.type !== "Identifier" && node.type !== "JSXIdentifier") return false;
  if (parent === undefined) return true;
  if (["ImportSpecifier", "ImportDefaultSpecifier", "ImportNamespaceSpecifier", "ExportSpecifier", "ExportNamespaceSpecifier"].includes(parent.type)) return false;
  if (["LabeledStatement", "BreakStatement", "ContinueStatement", "JSXAttribute"].includes(parent.type)) return false;
  if ((parent.type === "MemberExpression" || parent.type === "OptionalMemberExpression") && node.role === "property" && parent.attributes.computed !== true) return false;
  if (["ClassMethod", "ClassPrivateMethod", "ObjectMethod", "ClassProperty", "ClassPrivateProperty", "PropertyDefinition", "ClassAccessorProperty", "ObjectProperty"].includes(parent.type) && node.role === "key" && parent.attributes.computed !== true) return false;
  return true;
}

function isBindingPosition(parent: ASTNode, child: ASTNode, parentIsBinding: boolean): boolean {
  if (["ImportSpecifier", "ImportDefaultSpecifier", "ImportNamespaceSpecifier"].includes(parent.type)) return true;
  if (["FunctionDeclaration", "TSDeclareFunction", "FunctionExpression", "ArrowFunctionExpression", "ClassMethod", "ClassPrivateMethod", "ObjectMethod"].includes(parent.type)) {
    return child.role === "id" || child.role === "param" || child.role === "params";
  }
  if ((parent.type === "ClassDeclaration" || parent.type === "ClassExpression" || parent.type === "VariableDeclarator" || parent.type === "TSImportEqualsDeclaration") && child.role === "id") return true;
  if (parent.type === "CatchClause" && child.role === "param") return true;
  if (!parentIsBinding) return false;
  if (parent.type === "AssignmentPattern") return child.role === "left";
  if (parent.type === "ObjectProperty") return child.role === "value";
  return ["ArrayPattern", "ObjectPattern", "RestElement"].includes(parent.type);
}

function extractMemberContainerAndMethod(node: ASTNode, context: ResolutionContext): { containerName?: string; methodName?: string } {
  const left = node.children.find((child) => child.role === "left");
  if (left === undefined) return {};
  if (left.type === "MemberExpression" || left.type === "OptionalMemberExpression") {
    const obj = left.children.find((c) => c.role === "object");
    const prop = left.children.find((c) => c.role === "property");
    const containerName = obj === undefined ? undefined : memberName(obj, context);
    let methodName: string | undefined;
    if (left.attributes.computed === true) {
      methodName = resolvePropertyKey(prop, context);
    } else {
      methodName = prop === undefined ? undefined : (identifier(prop) ?? memberName(prop, context));
    }
    return { containerName, methodName };
  }
  return {};
}

function childContext(node: ASTNode, context: ResolutionContext, index: FileSymbolIndex): ResolutionContext {
  let scope = context.scope;
  let callerName = context.callerName;
  let containerId = context.containerId;
  let containerName = context.containerName;
  scope = frameFor(node, context.scope);
  if (isCallable(node)) callerName = nodeName(node) ?? callerName;
  if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
    containerId = findClassSymbolId(node, index);
    // An anonymous class expression is named by what it is assigned to, or anonymous-class: never by the class around it.
    const expressionName = node.type === "ClassExpression" && node.location !== undefined
      ? index.classByLocation.get(symbolLocationKey(node.location.start.line, node.location.start.column))?.name
      : undefined;
    containerName = nodeName(node) ?? expressionName ?? containerName;
  }
  if (node.type === "ClassMethod" || node.type === "ClassPrivateMethod") {
    // Class members are always visited directly below their ClassDeclaration.
    containerId = context.containerId;
    containerName = context.containerName;
  } else if (node.type === "AssignmentExpression") {
    const { containerName: cName, methodName: mName } = extractMemberContainerAndMethod(node, context);
    if (cName !== undefined) {
      containerName = cName;
      containerId = undefined;
    }
    if (mName !== undefined) {
      callerName = mName;
    }
  } else if (node.type === "VariableDeclarator") {
    const binding = node.children.find((c) => c.role === "id");
    const init = node.children.find((c) => c.role === "init");
    if (binding?.type === "Identifier" && init?.type === "ObjectExpression") {
      containerName = identifier(binding);
      containerId = undefined;
    }
  } else if (node.type === "ObjectProperty") {
    const key = node.children.find((c) => c.role === "key");
    const keyName = key === undefined ? undefined : (identifier(key) ?? memberName(key, context));
    if (keyName !== undefined) {
      callerName = keyName;
    }
  } else if (node.type === "ObjectMethod") {
    containerId = undefined;
  } else if (node.type === "FunctionDeclaration") {
    containerId = undefined;
    containerName = undefined;
  } else if (node.type === "FunctionExpression") {
    if (node.role !== "right" && node.role !== "value") {
      containerId = undefined;
      containerName = undefined;
    }
  }
  const thisClass = thisClassFor(node, context);
  return {
    callerName,
    scope,
    ...(containerId === undefined ? {} : { containerId }),
    ...(containerName === undefined ? {} : { containerName }),
    receiverTypes: context.receiverTypes,
    constantBindings: context.constantBindings,
    ...(context.withOuter === undefined ? {} : { withOuter: context.withOuter }),
    ...(context.hierarchy === undefined ? {} : { hierarchy: context.hierarchy }),
    ...(context.factories === undefined ? {} : { factories: context.factories }),
    ...(context.globalWrites === undefined ? {} : { globalWrites: context.globalWrites }),
    ...(thisClass === undefined ? {} : { thisClass }),
  };
}

/**
 * What `this` is inside `node`. A class method's body (and an arrow function in it) sees the instance, or the class
 * for a static method; so does a field initializer or static block. A class body itself, and any other function,
 * sees another `this`. Class members are visited directly below their class, whose symbol is `containerId`.
 */
function thisClassFor(node: ASTNode, context: ResolutionContext): ThisClass | undefined {
  if (node.type === "ArrowFunctionExpression") return context.thisClass;
  if (node.type === "ClassMethod" || node.type === "ClassPrivateMethod") {
    if (context.containerId === undefined) return undefined;
    const kind = node.attributes.kind;
    const name = kind === "constructor" ? undefined : methodKeyName(node);
    // A method whose name is computed may be borrowed under any name: it never counts as unborrowed.
    if (kind !== "constructor" && name === undefined) return undefined;
    return { classId: context.containerId, isStatic: node.attributes.static === true, ...(name === undefined ? {} : { method: name }) };
  }
  if (classFieldTypes.has(node.type) || node.type === "StaticBlock") {
    return context.containerId === undefined ? undefined : { classId: context.containerId, isStatic: node.type === "StaticBlock" || node.attributes.static === true };
  }
  if (isCallable(node) || node.type === "ClassDeclaration" || node.type === "ClassExpression") return undefined;
  return context.thisClass;
}

/** A method's name for the borrowing check; a private method (`#m`) cannot be read outside its class at all. */
function methodKeyName(method: ASTNode): string | undefined {
  const key = method.children.find((child) => child.role === "key");
  if (key?.type === "PrivateName") return undefined;
  return method.attributes.computed === true ? staticPropertyKey(key) : key?.type === "Identifier" ? identifier(key) : staticPropertyKey(key);
}

/**
 * Inside a `with (o)` body a free name may be a property of `o` (NA-02): a call is unproven unless its
 * root name binds in a frame the body itself created. `this` and `super` are never looked up in `o`.
 */
function withMayBind(calleeName: string, context: ResolutionContext, index: FileSymbolIndex): boolean {
  const outer = context.withOuter;
  if (outer === undefined) return false;
  const root = calleeName.split(".")[0] ?? calleeName;
  if (root === "this" || root === "super") return false;
  for (let frame: ScopeFrame | undefined = context.scope; frame !== undefined && frame.id !== outer.id; frame = frame.parent) {
    if (frame.selfName === root) return false;
    const binding = index.lexicalBindings.get(lexicalBindingKey(frame.id, root));
    if (binding !== undefined && binding.state !== "NO_BINDING") return false;
  }
  return true;
}

// The class's own symbol, found by location. Never by name: a class expression may share its
// name with an unrelated class declaration (class expressions have no symbol of their own).
function findClassSymbolId(node: ASTNode, index: FileSymbolIndex): string | undefined {
  const loc = node.location;
  return loc === undefined ? undefined : index.classByLocation.get(symbolLocationKey(loc.start.line, loc.start.column))?.id;
}

function isBoundCall(node: ASTNode, context?: ResolutionContext): boolean {
  if (node.type !== "CallExpression" && node.type !== "OptionalCallExpression") return false;
  const callee = node.children.find((child) => child.role === "callee");
  if (callee === undefined) return false;
  if (callee.type !== "MemberExpression" && callee.type !== "OptionalMemberExpression") return false;
  const property = callee.children.find((child) => child.role === "property");
  if (callee.attributes.computed === true) {
    if (context === undefined) return false;
    return resolvePropertyKey(property, context) === "bind";
  }
  return identifier(property) === "bind";
}

function collectBoundCalleeChain(calleeNode: ASTNode, context?: ResolutionContext, boundCallees?: Set<ASTNode>): ASTNode {
  let current = calleeNode;
  while (isBoundCall(current, context)) {
    boundCallees?.add(current);
    const callee = current.children.find((child) => child.role === "callee");
    const object = callee?.children.find((child) => child.role === "object");
    if (object === undefined) break;
    current = object;
  }
  return current;
}

/** `call`, `apply` and `bind` properties that callName looks through on the way to the callee. */
function invokerProperties(call: ASTNode): string[] {
  const names: string[] = [];
  for (let current = calleeOf(call); current !== undefined;) {
    if (current.type === "CallExpression" || current.type === "OptionalCallExpression") {
      current = current.children.find((child) => child.role === "callee");
    } else if (current.type === "MemberExpression" || current.type === "OptionalMemberExpression") {
      const name = memberPropertyName(current);
      if (name === "call" || name === "apply" || name === "bind") names.push(name);
      current = current.children.find((child) => child.role === "object");
    } else {
      break;
    }
  }
  return names;
}

/** The function a call, `new` or tagged template invokes (a tagged template calls its tag). */
function calleeOf(node: ASTNode): ASTNode | undefined {
  const role = node.type === "TaggedTemplateExpression" ? "tag" : "callee";
  const callee = node.children.find((child) => child.role === role);
  // `(0, lib_1.f)()`, tsc's call form for imports, calls the sequence's last value (BA-12).
  return callee?.type === "SequenceExpression" ? callee.children.filter((child) => child.role === "expressions").at(-1) : callee;
}

function callName(node: ASTNode, context: ResolutionContext, boundCallees?: Set<ASTNode>): string | undefined {
  const callee = calleeOf(node);
  if (callee === undefined) return undefined;
  const effectiveCallee = collectBoundCalleeChain(callee, context, boundCallees);
  return memberName(effectiveCallee, context, boundCallees);
}

/**
 * A readable, deterministic name for a callee that no name denotes (NA-01): `mk().run`, `new K().m`,
 * `o[<dynamic>]`, `super.m`, `<function>`. Such a call is never resolved; the name only keeps the
 * call site visible as an explicit UNRESOLVED fact instead of leaving it out.
 */
function unnamedCalleeName(node: ASTNode, context: ResolutionContext): string {
  const callee = calleeOf(node);
  return callee === undefined ? "<dynamic>" : describeCallee(callee, context);
}

function describeCallee(node: ASTNode, context: ResolutionContext): string {
  switch (node.type) {
    case "Super":
      return "super";
    case "FunctionExpression":
    case "ArrowFunctionExpression":
    case "ClassExpression":
      return "<function>";
    // One level only: a call result is named by its own callee or `<dynamic>`, so a long builder chain
    // (`q.a().b().c()…`) gives names of bounded length, not ones that repeat the whole prefix per link.
    case "CallExpression":
    case "OptionalCallExpression":
    case "TaggedTemplateExpression":
      return `${callName(node, context) ?? "<dynamic>"}()`;
    case "NewExpression":
      return `new ${callName(node, context) ?? "<dynamic>"}()`;
    case "MemberExpression":
    case "OptionalMemberExpression": {
      const object = node.children.find((child) => child.role === "object");
      const property = node.children.find((child) => child.role === "property");
      const objectName = object === undefined ? "<dynamic>" : describeCallee(object, context);
      if (node.attributes.computed === true) {
        const key = resolvePropertyKey(property, context) ?? (property?.type === "NumericLiteral" ? String(property.attributes.value) : undefined);
        return `${objectName}[${key ?? "<dynamic>"}]`;
      }
      return `${objectName}.${(property === undefined ? undefined : memberName(property, context)) ?? "<dynamic>"}`;
    }
    default:
      return memberName(node, context) ?? "<dynamic>";
  }
}

function memberName(node: ASTNode, context?: ResolutionContext, boundCallees?: Set<ASTNode>): string | undefined {
  if (node.type === "Identifier") return identifier(node);
  if (node.type === "PrivateName") {
    const name = identifier(node);
    return name !== undefined ? `#${name}` : undefined;
  }
  if (node.type === "ThisExpression") return "this";
  if (node.type !== "MemberExpression" && node.type !== "OptionalMemberExpression") return undefined;

  const object = node.children.find((child) => child.role === "object");
  const property = node.children.find((child) => child.role === "property");
  const effectiveObject = object === undefined ? undefined : collectBoundCalleeChain(object, context, boundCallees);
  const objectName = effectiveObject === undefined ? undefined : memberName(effectiveObject, context, boundCallees);

  let propertyName: string | undefined;
  if (node.attributes.computed === true) {
    if (context === undefined) return undefined;
    propertyName = resolvePropertyKey(property, context);
  } else {
    propertyName = property === undefined ? undefined : memberName(property, context, boundCallees);
  }

  if (objectName === undefined || propertyName === undefined) return undefined;

  // Unwrap .apply / .call invocations: e.g. server.listen.apply -> server.listen
  if ((propertyName === "apply" || propertyName === "call") && objectName !== "this") {
    return objectName;
  }

  return `${objectName}.${propertyName}`;
}

function targetScopeForDeclaration(node: ASTNode, name: string, scope: ScopeFrame, index: FileSymbolIndex): ScopeFrame {
  const symbol = (index.byName.get(name) ?? []).find(
    (s) => s.name === name && (
      (node.location !== undefined && s.location !== undefined &&
       s.location.start.line === node.location.start.line &&
       s.location.start.column === node.location.start.column) ||
      (s.scopeId === scope.id)
    ),
  );
  if (symbol !== undefined && symbol.declarationKind === "var") {
    for (let current: ScopeFrame | undefined = scope; current !== undefined; current = current.parent) {
      if (current.id === symbol.scopeId) {
        return current;
      }
    }
  }
  return scope;
}

// Receiver bindings are marked here so nested resolution sees them as declared (shadowing);
// their class is proven per call site by provenReceiverClass, never by visit order.
function recordReceiverType(node: ASTNode, context: ResolutionContext, index: FileSymbolIndex): void {
  const boundNames = extractBoundNames(node.children.find((child) => child.role === "id"));
  for (const name of boundNames) {
    const targetScope = targetScopeForDeclaration(node, name, context.scope, index);
    (context.receiverTypes as Map<string, string | null>).set(receiverKey(targetScope, name), null);
  }
}

function targetScopeForAssignment(name: string, scope: ScopeFrame, index: FileSymbolIndex): ScopeFrame {
  for (let current: ScopeFrame | undefined = scope; current !== undefined; current = current.parent) {
    const candidates = index.byScopeAndName.get(lexicalBindingKey(current.id, name)) ?? [];
    if (candidates.length > 0 || current.selfName === name) {
      return current;
    }
  }
  return scope;
}

function recordAssignmentReceiverType(node: ASTNode, context: ResolutionContext, index: FileSymbolIndex): void {
  const left = node.children.find((child) => child.role === "left");
  for (const name of extractBoundNames(left)) {
    const targetScope = targetScopeForAssignment(name, context.scope, index);
    (context.receiverTypes as Map<string, string | null>).set(receiverKey(targetScope, name), null);
  }
}

function predeclareScopeBindings(node: ASTNode, context: ResolutionContext): void {
  for (const child of node.children) {
    if (child.type === "FunctionDeclaration" || child.type === "ClassDeclaration") {
      const declName = nodeName(child);
      if (declName !== undefined) {
        (context.receiverTypes as Map<string, string | null>).set(receiverKey(context.scope, declName), null);
        (context.constantBindings as Map<string, string | null>).set(bindingKey(context.scope, declName), null);
      }
    }
  }
  // Until its declarator runs, a hoisted `var` holds undefined and a `let`/`const` cannot be
  // read, so neither may expose an outer constant of the same name to a computed key.
  for (const name of hoistedNames(node)) {
    (context.constantBindings as Map<string, string | null>).set(bindingKey(context.scope, name), null);
  }
}

/** Names declared in the scope `node` opens before their declarations run. */
function hoistedNames(node: ASTNode): string[] {
  const declared = (declaration: ASTNode): string[] =>
    declaration.children.filter((child) => child.role === "declarations").flatMap((declarator) => extractBoundNames(declarator.children.find((child) => child.role === "id")));
  const names: string[] = [];
  if (node.type === "Program" || node.type === "BlockStatement") {
    for (const child of node.children) if (child.type === "VariableDeclaration" && child.attributes.kind !== "var") names.push(...declared(child));
  }
  if (node.type === "Program" || isCallable(node)) {
    const visit = (current: ASTNode): void => {
      if (isCallable(current) || current.type === "ClassDeclaration" || current.type === "ClassExpression") return;
      if (current.type === "VariableDeclaration" && current.attributes.kind === "var") names.push(...declared(current));
      for (const child of current.children) visit(child);
    };
    for (const child of node.children) if (node.type === "Program" || child.role === "body") visit(child);
  }
  return names;
}

function recordParamReceiverTypes(node: ASTNode, context: ResolutionContext): void {
  for (const child of node.children.filter((c) => c.role === "param" || c.role === "params")) {
    const paramNames = extractBoundNames(child);
    for (const name of paramNames) {
      (context.receiverTypes as Map<string, string | null>).set(receiverKey(context.scope, name), null);
    }
  }
}

function recordParamConstantBindings(node: ASTNode, context: ResolutionContext): void {
  for (const child of node.children.filter((c) => c.role === "param" || c.role === "params")) {
    const paramNames = extractBoundNames(child);
    for (const name of paramNames) {
      (context.constantBindings as Map<string, string | null>).set(bindingKey(context.scope, name), null);
    }
  }
}

function recordConstantBinding(node: ASTNode, context: ResolutionContext, index: FileSymbolIndex): void {
  const binding = node.children.find((child) => child.role === "id");
  const initializer = node.children.find((child) => child.role === "init");
  const boundNames = extractBoundNames(binding);
  if (boundNames.length === 0) return;

  let isConst = false;
  if (boundNames.length === 1) {
    const symbol = (index.byName.get(boundNames[0]!) ?? []).find(
      (s) => s.name === boundNames[0] && (
        (node.location !== undefined && s.location !== undefined &&
         s.location.start.line === node.location.start.line &&
         s.location.start.column === node.location.start.column) ||
        (s.scopeId === context.scope.id)
      ),
    );
    if (symbol?.declarationKind === "const") {
      isConst = true;
    }
  }

  if (isConst && boundNames.length === 1 && binding?.type === "Identifier") {
    const stringVal = extractStaticString(initializer);
    const targetScope = targetScopeForDeclaration(node, boundNames[0]!, context.scope, index);
    (context.constantBindings as Map<string, string | null>).set(
      bindingKey(targetScope, boundNames[0]!),
      stringVal ?? null,
    );
    return;
  }

  for (const name of boundNames) {
    const targetScope = targetScopeForDeclaration(node, name, context.scope, index);
    (context.constantBindings as Map<string, string | null>).set(bindingKey(targetScope, name), null);
  }
}

function recordAssignmentConstantBinding(node: ASTNode, context: ResolutionContext, index: FileSymbolIndex): void {
  const left = node.children.find((child) => child.role === "left");
  const boundNames = extractBoundNames(left);
  for (const name of boundNames) {
    const targetScope = targetScopeForAssignment(name, context.scope, index);
    (context.constantBindings as Map<string, string | null>).set(bindingKey(targetScope, name), null);
  }
}

function resolvePropertyKey(node: ASTNode | undefined, context: ResolutionContext): string | undefined {
  if (node === undefined) return undefined;
  if (node.type === "StringLiteral") {
    return typeof node.attributes.value === "string" ? node.attributes.value : undefined;
  }
  if (node.type === "TemplateLiteral") {
    return extractStaticString(node);
  }
  if (node.type === "Identifier") {
    const id = identifier(node);
    if (id === undefined) return undefined;
    return lookupConstant(id, context.scope, context.constantBindings);
  }
  return undefined;
}

function lookupConstant(name: string, scope: ScopeFrame, bindings: ReadonlyMap<string, string | null>): string | undefined {
  for (let current: ScopeFrame | undefined = scope; current !== undefined; current = current.parent) {
    if (current.selfName === name) return undefined;
    const entry = bindings.get(bindingKey(current, name));
    if (entry !== undefined) {
      return entry === null ? undefined : entry;
    }
  }
  return undefined;
}

/**
 * The import a `require` inside a function binds, as the call at `scope` sees it: the one binding there is
 * that import alone (no other declaration, parameter or block supplies the name), declared in a scope that
 * never rebinds it.
 */
function scopedImport(index: FileSymbolIndex, name: string, scope: ScopeFrame): CodeSymbol | undefined {
  const binding = resolveLexicalBinding(index, name, scope);
  if (binding.state !== "ONE_BINDING" || binding.referenceTargets.length !== 1) return undefined;
  const imported = binding.referenceTargets[0];
  if (imported?.kind !== "import") return undefined;
  const frame = declaredBindingFrame(index, name, scope);
  return frame === undefined || isRebound(index, frame.id, name) ? undefined : imported;
}

interface CanonicalTables { readonly knownPaths: ReadonlySet<string>; readonly byCanonicalPath: ReadonlyMap<string, SymbolTable> }
const canonicalTablesCache = new WeakMap<ReadonlyMap<string, SymbolTable>, CanonicalTables>();

/**
 * The canonical path index of one run's symbol tables, built once. Rebuilding it per namespace call cost
 * files × calls path normalizations (and defeated the resolver's own cache, keyed by set identity).
 */
function canonicalTables(tablesByPath: ReadonlyMap<string, SymbolTable>): CanonicalTables {
  const cached = canonicalTablesCache.get(tablesByPath);
  if (cached !== undefined) return cached;
  const byCanonicalPath = new Map<string, SymbolTable>();
  for (const [path, table] of tablesByPath) {
    const canonical = canonicalizePath(path);
    if (!byCanonicalPath.has(canonical)) byCanonicalPath.set(canonical, table);
  }
  const built: CanonicalTables = { knownPaths: new Set(byCanonicalPath.keys()), byCanonicalPath };
  canonicalTablesCache.set(tablesByPath, built);
  return built;
}

function resolveNamespaceCall(
  table: SymbolTable,
  index: FileSymbolIndex,
  importSymbol: CodeSymbol,
  methodName: string,
  tablesByPath: ReadonlyMap<string, SymbolTable>,
  resolver: ModuleResolver,
  context: ResolutionContext,
): string | undefined {
  if (importSymbol.moduleSpecifier === undefined || holdsStaleExports(index, importSymbol)) return undefined;
  // `const m = require("./x")` binds x's exports object: a namespace while x never replaces
  // `module.exports`, m is never rebound and no code here writes the member (BA-12).
  const wholeModuleRequire = importSymbol.defaultExport && importSymbol.sourceSymbolName === undefined
    && (table.moduleReferences ?? []).some((reference) => reference.form === "commonjs-import" && reference.importSymbolIds.includes(importSymbol.id));
  if (importSymbol.sourceSymbolName !== "*" && !wholeModuleRequire) {
    return undefined;
  }
  if (wholeModuleRequire) {
    const frame = declaredBindingFrame(index, importSymbol.name, context.scope);
    if (frame === undefined || isRebound(index, frame.id, importSymbol.name) || propertyWriteCount(index, methodName) > 0) return undefined;
  }

  const tables = canonicalTables(tablesByPath);
  const canonicalImporter = canonicalizePath(table.filePath);
  const resolved = resolver.resolve(canonicalImporter, importSymbol.moduleSpecifier, tables.knownPaths);
  if (resolved.resolvedPath === null) return undefined;

  const targetTable = tablesByPath.get(resolved.resolvedPath) ?? tables.byCanonicalPath.get(resolved.resolvedPath);
  if (targetTable === undefined) return undefined;

  if (wholeModuleRequire) {
    // C3a: a module that builds its exports object plainly (`module.exports = { … }`, or an alias it fills).
    const member = context.factories?.exportMemberOf(canonicalizePath(targetTable.filePath), methodName);
    if (member !== undefined) return isUnstableTarget(index, member) ? undefined : member;
    if (targetTable.symbols.some((s) => s.kind === "export" && s.defaultExport)) return undefined;
    const property = targetTable.symbols.filter((s) => s.kind === "export" && s.moduleSpecifier === undefined && s.name === methodName);
    return property.length === 1 && property[0] !== undefined && !isUnstableTarget(index, property[0].id) ? property[0].id : undefined;
  }

  const exportSymbol = targetTable.symbols.find((s) => s.kind === "export" && s.name === methodName);
  if (exportSymbol !== undefined) {
    return isUnstableTarget(index, exportSymbol.id) ? undefined : exportSymbol.id;
  }
  const directSymbol = targetTable.symbols.find(
    (s) => (s.kind === "function" || s.kind === "class" || s.kind === "variable") && s.exported && s.name === methodName,
  );
  return isUnstableTarget(index, directSymbol?.id) ? undefined : directSymbol?.id;
}

/**
 * Rule 2, object container method (e.g. app.init after `app.init = function …`): the container binding never changes,
 * the property is declared once on that same binding and never otherwise written, here or by name in another file
 * (RT-H1), and the call cannot run before the definition takes effect.
 */
function containerMethod(index: FileSymbolIndex, receiver: string, methodName: string, context: ResolutionContext, callNode: ASTNode | undefined): string | undefined {
  const containerFrame = declaredBindingFrame(index, receiver, context.scope);
  if (containerFrame === undefined || isRebound(index, containerFrame.id, receiver)) return undefined;
  const declared = (index.byName.get(methodName) ?? []).filter(
    (symbol) => symbol.containerName === receiver && isDefinedOnBinding(index, symbol, receiver, containerFrame),
  );
  const candidates = declared.filter((symbol) => symbol.kind === "method" || symbol.kind === "function");
  const candidate = candidates.length === 1 && declared.length === 1 ? candidates[0] : undefined;
  // A member-assigned definition is itself the one permitted write; a class member admits none
  // and, called on the class, must be a static method declared in its body.
  if (candidate === undefined || propertyWriteCount(index, methodName) !== (candidate.containerId === undefined ? 1 : ownPropertyWrites(index, candidate))) return undefined;
  if (writtenInOtherFile(context, methodName, candidate)) return undefined;
  const proven = candidate.containerId !== undefined
    ? isClassBodyMethod(index, candidate, candidate.containerId, true)
    : isDefinedBeforeCall(index, candidate, receiver, containerFrame, callNode);
  return proven ? candidate.id : undefined;
}

/** `P` in `Object.create(P)` with exactly one plain-identifier argument, `Object` the unbound, unwritten global. */
function objectCreateArgument(value: ASTNode | undefined, index: FileSymbolIndex, context: ResolutionContext): string | undefined {
  if (value?.type !== "CallExpression") return undefined;
  const path = memberPathOf(value.children.find((child) => child.role === "callee"));
  if (path?.length !== 2 || path[0] !== "Object" || path[1] !== "create" || !isUnboundName(index, "Object", context)) return undefined;
  if (context.globalWrites === undefined || !globalPathUnwritten(path, context.globalWrites)) return undefined;
  const args = value.children.filter((child) => child.role === "arguments");
  return args.length === 1 && args[0]!.type === "Identifier" ? identifier(args[0]) : undefined;
}

/**
 * RT-H1: whether a file other than `symbol`'s may write a property named `name` by name on an object that is not its
 * own `this` or exports (`require("./lib").app.init = …`, or `app.init = …` on an imported `app`). Such a write may
 * replace the method on the very object a rule 1 or rule 2 call reaches; the defining file's own writes are counted
 * where the call is (propertyWriteCount). Private names cannot be written outside their class. Without the
 * repository's write facts (no hierarchy) nothing is known about other files, so any public name may be written.
 */
function writtenInOtherFile(context: ResolutionContext, name: string, symbol: CodeSymbol): boolean {
  if (name.startsWith("#")) return false;
  return context.hierarchy === undefined || context.hierarchy.isWrittenOutside(name, canonicalizePath(symbol.filePath));
}

function resolveLocalCall(
  table: SymbolTable | undefined,
  index: FileSymbolIndex,
  name: string,
  context: ResolutionContext,
  tablesByPath?: ReadonlyMap<string, SymbolTable>,
  resolver?: ModuleResolver,
  callNode?: ASTNode,
): string | undefined {
  if (table === undefined) return undefined;
  const pieces = name.split(".");
  if (pieces.length === 1) return nearestScoped(index, name, context)?.id;
  if (pieces.length !== 2) return undefined;
  const [receiver, methodName] = pieces;
  if (receiver === undefined || methodName === undefined) return undefined;

  // RESOLVED means proven (it feeds flow ProvenCallTarget). Public `this` dispatch is never
  // proven: subclasses override it and methods can be borrowed with another `this`.

  // 1. Class instance receiver: a binding proven to hold `new C()` at this call (see
  //    provenReceiverClass), or `this` for private `#methods`, which can be neither
  //    overridden nor borrowed.
  //    The instance must really be a C (constructsInstance), and the method declared in C's body.
  const classId = receiver === "this"
    ? (methodName.startsWith("#") ? context.containerId : undefined)
    : provenReceiverClass(index, receiver, context, callNode);
  if (classId !== undefined && (receiver === "this" || constructsInstance(index, classId))) {
    const candidates = (index.byName.get(methodName) ?? []).filter(
      (symbol) => symbol.kind === "method" && symbol.containerId === classId && isClassBodyMethod(index, symbol, classId, receiver === "this" ? undefined : false),
    );
    const candidate = candidates.length === 1 ? candidates[0] : undefined;
    // No other write may replace it, in this file or another: a field's own initializer is the one permitted write.
    if (candidate !== undefined && propertyWriteCount(index, methodName) === ownPropertyWrites(index, candidate)
      && !writtenInOtherFile(context, methodName, candidate)) return candidate.id;
  }

  // 1b. Public `this` dispatch, where `this` is the instance (or class) of C (thisClassFor): C declares the method
  //     once in its body and nothing in this file replaces it, no class extending C anywhere in the repository
  //     defines that name, and the method this call runs in is never read as a value anywhere, so it cannot run
  //     with another `this` (see class-hierarchy.ts for the assumptions).
  const thisClass = context.thisClass;
  if (receiver === "this" && !methodName.startsWith("#") && thisClass !== undefined && context.hierarchy !== undefined) {
    const candidates = (index.byName.get(methodName) ?? []).filter(
      (symbol) => symbol.kind === "method" && symbol.containerId === thisClass.classId && isClassBodyMethod(index, symbol, thisClass.classId, thisClass.isStatic),
    );
    const candidate = candidates.length === 1 ? candidates[0] : undefined;
    if (candidate !== undefined && propertyWriteCount(index, methodName) === ownPropertyWrites(index, candidate)
      && !context.hierarchy.mayOverride(thisClass.classId, methodName)
      && (thisClass.method === undefined || !context.hierarchy.isBorrowed(thisClass.method, thisClass.classId))) return candidate.id;
  }

  // 1c. Factory object (Phase C1): `const x = F()` where the call resolved to a repository factory that returns one
  //     object literal, which holds a function at `methodName` that no file replaces (see factory-objects.ts). The
  //     binding is written once, and the factory call was resolved before this one in the file.
  if (receiver !== "this" && context.factories !== undefined) {
    const frame = declaredBindingFrame(index, receiver, context.scope);
    if (frame !== undefined && !isRebound(index, frame.id, receiver)) {
      const declared = index.writes.declaredValues.get(bindingWriteKey(frame.id, receiver));
      const init = assignedValue(declared);
      // C1c, red-team RT-PR-A: through a chain (`var app = module.exports = f()`) the object is also the file's exports,
      // which own-exports writes (`module.exports.use = …`, exempt elsewhere) can change; no write of the name may exist.
      const chained = init !== declared;
      // 1d. Constructor prototype (Phase C2): `const x = new F()` where F's prototype holds `methodName`.
      const producer = chained && propertyWriteCount(index, methodName) > 0 ? undefined
        : init?.type === "CallExpression" || init?.type === "NewExpression" ? resolvedCallTargets.get(index)?.get(init) : undefined;
      const start = callNode?.location?.start;
      const topLevelCall = context.callerName === "module" && start !== undefined ? { filePath: canonicalizePath(table.filePath), line: start.line, column: start.column } : undefined;
      const method = producer === undefined ? undefined : context.factories.methodOf(producer, methodName, init?.type === "NewExpression", topLevelCall);
      if (method !== undefined) return method;
    }
  }

  // 1e. Object.create (Phase C2): `const x = Object.create(P)`, with one argument, makes an object with no own
  //     properties whose prototype is P; `x.m()` reaches P's `m` as `P.m()` would (rule 2), when no file writes a
  //     property named `m` elsewhere (XA-03) and `Object.create` is the unwritten global.
  if (receiver !== "this") {
    const frame = declaredBindingFrame(index, receiver, context.scope);
    const init = frame === undefined || isRebound(index, frame.id, receiver) ? undefined : index.writes.declaredValues.get(bindingWriteKey(frame.id, receiver));
    const prototype = objectCreateArgument(init, index, context);
    // containerMethod checks the writes of other files too (RT-H1).
    const target = prototype === undefined ? undefined : containerMethod(index, prototype, methodName, context, callNode);
    if (target !== undefined) return target;
  }

  // 2. Object container method (e.g. app.init after `app.init = function …`).
  const target = receiver === "this" ? undefined : containerMethod(index, receiver, methodName, context, callNode);
  if (target !== undefined) return target;

  // 3. Imported namespace receiver (e.g. import * as api from "./api"; api.ping() or api["ping"]())
  const namespaceImport = receiver === "this" || isLexicallyShadowed(receiver, context, index) ? undefined : visibleImport(index, receiver, context.scope);
  if (namespaceImport !== undefined && tablesByPath !== undefined && resolver !== undefined) {
    const namespaceTarget = resolveNamespaceCall(table, index, namespaceImport, methodName, tablesByPath, resolver, context);
    if (namespaceTarget !== undefined) return namespaceTarget;
  }

  return undefined;
}

// Standard properties a fresh object or function already has, own or inherited.
const objectBuiltins = new Set([
  "constructor", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString", "toString", "valueOf",
  "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__", "__proto__",
]);
const functionBuiltins = new Set([...objectBuiltins, "apply", "bind", "call", "arguments", "caller", "length", "name", "prototype"]);

/**
 * Whether no execution can reach the call while the container still holds a different
 * `name` than the member-assigned `definition`. Either the container starts as a fresh
 * object or function without that property, so an earlier call throws; or the definition
 * always runs earlier in the call's own execution context; or the call lies inside the
 * defined function, which exists only once the definition has run. Assumes property
 * assignments store their value (no setters, frozen objects or read-only properties) and
 * that no code adds properties to Object.prototype or Function.prototype.
 */
/**
 * Why an unresolved call is not proven (A1). The blocking checks come first, in the order resolution applies them;
 * otherwise the callee's shape names what was not proven. Classification only: it never changes a resolution.
 */
function unresolvedReason(input: {
  readonly named: boolean;
  readonly evalOrWith: boolean;
  readonly invokerWritten: boolean;
  readonly runsTooEarly: boolean;
  readonly imported: CodeSymbol | undefined;
  readonly importTarget: string | undefined;
  readonly calleeName: string;
  readonly index: FileSymbolIndex;
  readonly context: ResolutionContext;
}): UnresolvedReason {
  if (!input.named) return /\)\.[^.()[\]]+$/.test(input.calleeName) ? "call-result-member" : "computed-callee";
  if (input.evalOrWith) return "eval-or-with";
  if (input.invokerWritten) return "invoker-written";
  if (input.runsTooEarly) return "runs-before-binding";
  const { imported, calleeName, index, context } = input;
  if (imported !== undefined) {
    if (input.importTarget !== undefined) return "import-unstable";
    return isRepositoryImport(index, imported.moduleSpecifier) ? "import-unresolved" : "package-import";
  }
  if (calleeName === "require") return "module-load";
  const pieces = calleeName.split(".");
  const root = pieces[0] ?? calleeName;
  if (pieces.length === 1) return isUnboundName(index, root, context) ? "unbound-name" : isParameter(index, root, context) ? "parameter-callee" : "local-not-proven";
  if (root === "this") return pieces.length === 2 ? "this-open" : "member-chain";
  const rootImport = isLexicallyShadowed(root, context, index) ? undefined : visibleImport(index, root, context.scope);
  if (rootImport !== undefined) return isRepositoryImport(index, rootImport.moduleSpecifier) ? "import-member" : "package-import";
  if (isUnboundName(index, root, context)) return "global-member";
  if (isParameter(index, root, context)) return "parameter-member";
  return pieces.length === 2 ? "receiver-not-proven" : "member-chain";
}

/** Callables of a file by their start (`line:column`), to find the function a parameter's scope belongs to. */
const callablesByStart = new WeakMap<FileSymbolIndex, ReadonlyMap<string, readonly CodeSymbol[]>>();

/** The binding `name` sees is a parameter of the function whose scope declares it. */
function isParameter(index: FileSymbolIndex, name: string, context: ResolutionContext): boolean {
  const binding = resolveLexicalBinding(index, name, context.scope);
  if (binding.state !== "ONE_BINDING") return false;
  let byStart = callablesByStart.get(index);
  if (byStart === undefined) {
    const map = new Map<string, CodeSymbol[]>();
    for (const symbols of index.byName.values()) {
      for (const symbol of symbols) {
        if ((symbol.kind !== "function" && symbol.kind !== "method") || symbol.location === undefined) continue;
        const key = `${symbol.location.start.line}:${symbol.location.start.column}`;
        map.set(key, [...(map.get(key) ?? []), symbol]);
      }
    }
    byStart = map;
    callablesByStart.set(index, byStart);
  }
  return binding.referenceTargets.some((target) => {
    const scope = /^scope:[A-Za-z]+:(\d+):(\d+)$/.exec(target.scopeId ?? "");
    return scope !== null && (byStart.get(`${scope[1]}:${scope[2]}`) ?? []).some((callable) => (callable.parameters ?? []).includes(name));
  });
}
/** Whether each file being built is CommonJS, where `require` is the module wrapper's own function. */
const commonJsFiles = new WeakMap<FileSymbolIndex, boolean>();

/**
 * Whether a call runs before the CommonJS `require` that binds its callee (XA-05): the declarator runs in the call's
 * own execution context and ends after the call starts, so the binding is still in its TDZ (`const`, `let`) or
 * undefined (`var`) and the call throws. An ESM import is hoisted and has no declarator. A call in a nested
 * function is not judged: when that function runs is not known here.
 */
function callsBeforeRequire(index: FileSymbolIndex, imported: CodeSymbol, callNode: ASTNode): boolean {
  const anchor = declarationAnchor(imported.location);
  const declarator = anchor === undefined ? undefined : index.writes.declaratorSites.get(anchor);
  const call = index.writes.callSites.get(callNode);
  return declarator !== undefined && call !== undefined && declarator.contextId === call.contextId && comparePoints(call.start, declarator.end) < 0;
}

function isDefinedBeforeCall(index: FileSymbolIndex, definition: CodeSymbol, receiver: string, frame: ScopeFrame, callNode: ASTNode | undefined): boolean {
  return startsWithout(index, receiver, frame, definition.name) || definitionRunsFirst(index, definition.name, callNode) || encloses(definition.location, callNode?.location);
}

function startsWithout(index: FileSymbolIndex, receiver: string, frame: ScopeFrame, name: string): boolean {
  const value = index.writes.declaredValues.get(bindingWriteKey(frame.id, receiver));
  if (value?.type === "ObjectExpression") {
    // A spread, a computed key or a `__proto__` key may supply the property.
    return !objectBuiltins.has(name) && value.children.every((property) => {
      if (property.type !== "ObjectProperty" && property.type !== "ObjectMethod") return false;
      const key = propertyKeyName(property);
      return key !== undefined && key !== name && key !== "__proto__";
    });
  }
  const isFunction = value?.type === "FunctionDeclaration" || value?.type === "FunctionExpression" || value?.type === "ArrowFunctionExpression";
  return isFunction && !functionBuiltins.has(name);
}

function definitionRunsFirst(index: FileSymbolIndex, name: string, callNode: ASTNode | undefined): boolean {
  const call = callNode === undefined ? undefined : index.writes.callSites.get(callNode);
  const definitions = index.writes.propertyWriteSites.get(name) ?? [];
  const definition = definitions.length === 1 ? definitions[0] : undefined;
  return call !== undefined && definition !== undefined && definition.ordered && definition.unconditional &&
    definition.contextId === call.contextId && comparePoints(definition.end, call.start) < 0;
}

function encloses(outer: CodeSymbol["location"], inner: CodeSymbol["location"]): boolean {
  return outer !== undefined && inner !== undefined && comparePoints(outer.start, inner.start) <= 0 && comparePoints(inner.end, outer.end) <= 0;
}

/**
 * Whether `member` was defined on the `receiver` binding declared in `frame`. A same-named
 * binding elsewhere (a parameter, block local or catch parameter) may hold any object. A
 * class member belongs to the class that binding declares; any other member to the binding
 * that `receiver` names where the member is defined.
 */
function isDefinedOnBinding(index: FileSymbolIndex, member: CodeSymbol, receiver: string, frame: ScopeFrame): boolean {
  if (member.containerId !== undefined) {
    const declared = index.declarationsByScopeAndName.get(lexicalBindingKey(frame.id, receiver)) ?? [];
    return declared.length === 1 && declared[0]?.id === member.containerId;
  }
  const definedIn = member.scopeId === undefined ? undefined : index.writes.scopeFrames.get(member.scopeId);
  return definedIn !== undefined && declaredBindingFrame(index, receiver, definedIn)?.id === frame.id;
}

function nearestScoped(index: FileSymbolIndex, name: string, context: ResolutionContext): CodeSymbol | undefined {
  for (let current: ScopeFrame | undefined = context.scope; current !== undefined; current = current.parent) {
    if (current.selfName === name) return undefined;
    if (mayBelongToOtherBlock(index, current.id, name)) return undefined;
    const matchingSymbols = index.declarationsByScopeAndName.get(lexicalBindingKey(current.id, name)) ?? [];
    if (matchingSymbols.length > 0 && index.writes.unscopedBindings.has(bindingWriteKey(current.id, name))) return undefined;
    if (index.writes.blockFunctionVars.has(bindingWriteKey(current.id, name))) return undefined;
    const callableSymbols = matchingSymbols.filter((symbol) => symbol.kind === "function" || symbol.kind === "class");
    const nonCallableSymbols = matchingSymbols.filter((symbol) => symbol.kind !== "function" && symbol.kind !== "class");
    // A rebound function or class binding may name another callee when the call runs; a decorator may replace a class.
    if (callableSymbols.length === 1) return isRebound(index, current.id, name) || index.classes.decorated.has(callableSymbols[0]!.id) ? undefined : callableSymbols[0];
    if (callableSymbols.length > 1) return undefined;
    if (nonCallableSymbols.length > 0) return undefined;
    if (context.receiverTypes.has(receiverKey(current, name))) return undefined;
  }
  return undefined;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
