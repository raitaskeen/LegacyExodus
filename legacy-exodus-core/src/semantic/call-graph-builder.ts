import { createHash } from "node:crypto";

import type { ASTNode, ASTResult } from "@parser/index";
import { canonicalizePath, ModuleResolver, type DependencyGraph } from "@graph/index";
import type { SymbolTable } from "@symbols/index";
import { createLexicalScopeId, createSelfScopeId, FactKeyer, type CodeSymbol } from "@symbols/index";

import type { SemanticCall, SymbolReference } from "./semantic-contracts";
import { stableId } from "@shared/identity";
import { compareCodePoints } from "@shared/ordering";
import { immutable } from "@shared/immutability";

export class DeterministicCallGraphBuilder {
  /** @param resolver - the run's resolver (tsconfig aliases, workspace packages), shared with the dependency graph. */
  public constructor(public readonly resolver: ModuleResolver = new ModuleResolver()) {}

  public build(astResults: readonly ASTResult[], symbolTables: readonly SymbolTable[], dependencyGraph: DependencyGraph): { readonly calls: readonly SemanticCall[]; readonly references: readonly SymbolReference[] } {
    const tablesByPath = new Map(symbolTables.map((table) => [canonicalizePath(table.filePath), table]));
    const importsByFile = new Map<string, readonly { readonly id: string; readonly name: string }[]>();
    const targetByImportId = new Map(dependencyGraph.edges.map((edge) => [edge.importSymbolId, edge.targetExportSymbolId]));
    const unstableExportIds = new Set(astResults.flatMap((ast) => collectUnstableExportIds(ast, tablesByPath.get(canonicalizePath(ast.metadata.sourcePath)))));
    const calls: SemanticCall[] = [];
    const references: SymbolReference[] = [];

    for (const ast of [...astResults].sort((left, right) => compareCodePoints(left.metadata.sourcePath, right.metadata.sourcePath))) {
      this.buildForFile(ast, tablesByPath, importsByFile, targetByImportId, unstableExportIds, calls, references);
    }

    return immutable({ calls: immutable(calls), references: immutable(references) });
  }

  /**
   * @param unstableExportIds - Export symbols of every analyzed module whose value can change
   *   after definition (see collectUnstableExportIds); imports resolving to them stay UNRESOLVED.
   */
  public buildForFile(
    ast: ASTResult,
    tablesByPath: ReadonlyMap<string, SymbolTable>,
    importsByFile: ReadonlyMap<string, readonly { readonly id: string; readonly name: string }[]>,
    targetByImportId: ReadonlyMap<string, string>,
    unstableExportIds: ReadonlySet<string>,
    calls: SemanticCall[],
    references: SymbolReference[],
  ): void {
    const initialContext: ResolutionContext = {
      callerName: "module",
      scope: createScope("scope:module"),
      receiverTypes: new Map(),
      constantBindings: new Map(),
    };
    predeclareScopeBindings(ast.root, initialContext);
    const boundCallees = new Set<ASTNode>();
    const table = tablesByPath.get(canonicalizePath(ast.metadata.sourcePath));
    const fileSymbols = createFileSymbolIndex(table, ast, unstableExportIds);
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
        const imported = isShadowed
          ? undefined
          : visibleImport(fileSymbols, calleeName, nextContext.scope);
        const importTarget = imported === undefined ? undefined : targetByImportId.get(imported.id);
        // `f.call(…)`, `f.apply(…)` and `f.bind(…)(…)` are resolved as `f`; that holds only while those properties are the builtins.
        const invokesThroughWrittenProperty = invokerProperties(node).some((name) => propertyWriteCount(fileSymbols, name) > 0);
        const targetSymbolId = namedCallee === undefined || invokesThroughWrittenProperty || fileSymbols.directEval || withMayBind(calleeName, nextContext, fileSymbols)
          ? undefined
          : imported === undefined
            ? resolveLocalCall(table, fileSymbols, calleeName, nextContext, tablesByPath, this.resolver, node)
            : isRebound(fileSymbols, MODULE_SCOPE_ID, calleeName) || isUnstableTarget(fileSymbols, importTarget) ? undefined : importTarget;
        const id = hash(`${ast.metadata.sourcePath}:${nextContext.callerName}:${calleeName}:${node.location?.start.line ?? 0}:${node.location?.start.column ?? 0}`);
        const resolutionState = targetSymbolId === undefined ? "UNRESOLVED" as const : "RESOLVED" as const;
        const key = factKeyers.get(fileSymbols)?.key("call", calleeName, node.location?.start);
        const keyed = key === undefined ? {} : { key };
        const callId = key === undefined ? id : stableId("call", key);
        const reference: SymbolReference = { id: key === undefined ? hash(`reference:${id}`) : stableId("call-reference", key), ...keyed, filePath: ast.metadata.sourcePath, name: calleeName, kind: "call", resolutionState, ...(targetSymbolId === undefined ? {} : { resolvedSymbolId: targetSymbolId }) };
        references.push(reference);
        calls.push({ id: callId, ...keyed, sourceFilePath: ast.metadata.sourcePath, callerName: nextContext.callerName, calleeName, resolutionState, ...(targetSymbolId === undefined ? {} : { targetSymbolId }), ...(node.location === undefined ? {} : { location: node.location.start }) });
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

interface FileSymbolIndex {
  readonly byScopeAndName: ReadonlyMap<string, readonly CodeSymbol[]>;
  /** byScopeAndName restricted to symbols that declare a binding (see bindingDeclarations). */
  readonly declarationsByScopeAndName: ReadonlyMap<string, readonly CodeSymbol[]>;
  readonly byName: ReadonlyMap<string, readonly CodeSymbol[]>;
  readonly firstImportByName: ReadonlyMap<string, CodeSymbol>;
  readonly classByLocation: ReadonlyMap<string, CodeSymbol>;
  readonly lexicalBindings: ReadonlyMap<string, LexicalResolution>;
  /** Function, method and class symbols: the owners fact keys are built from (ADR-008). */
  readonly ownerSymbols: readonly CodeSymbol[];
  /**
   * For each block of a namespace that is declared in more than one block, the names declared in its
   * other blocks. TypeScript merges the exports of those blocks, so an unqualified name that this
   * block does not bind may mean a member of another block; it must not resolve to an outer binding.
   */
  readonly reopened: ReadonlyMap<string, ReadonlySet<string>>;
  readonly writes: BindingWrites;
  /** Export symbols (of any module) whose value can change after definition. */
  readonly unstableExportIds: ReadonlySet<string>;
  readonly classes: ClassFacts;
  /** The file calls `eval(…)` directly, which can declare or reassign any binding it sees: no call here is proven (NA-02). */
  readonly directEval: boolean;
}

/** Class structure read from the AST; the symbol table also files nested object literal methods under a class. */
interface ClassFacts {
  /** Declaration node of each class symbol. */
  readonly nodes: ReadonlyMap<string, ASTNode>;
  /** Class symbols that a decorator may replace. */
  readonly decorated: ReadonlySet<string>;
  /** Methods declared directly in a class body, by declaration anchor. */
  readonly members: ReadonlyMap<string, ClassMemberFact>;
}

interface ClassMemberFact {
  readonly classNode: ASTNode;
  readonly isStatic: boolean;
  /** `method`, `get`, `set` or `constructor`; `field` for a field initialized with a function. */
  readonly kind: string;
  readonly decorated: boolean;
}

/**
 * File-wide write evidence. A call target derived from a binding's value is proven
 * only when no execution can reach the call with a different value in that binding.
 */
interface BindingWrites {
  /** Binding keys (`scopeId:name`) declared more than once or written after declaration. */
  readonly reboundBindings: ReadonlySet<string>;
  /**
   * Member writes and deletions per property name (`anything.name = …`, `anything["name"] = …`,
   * `delete anything.name`, statically keyed Object/Reflect writes); private names as `#name`.
   */
  readonly propertyWrites: ReadonlyMap<string, number>;
  /** A write whose property name is not static (`o[key] = …`, `Object.assign(o, src)`, prototype swaps): it may name any public property. */
  readonly unknownPropertyWrites: boolean;
  /** Where each statically named member is assigned or deleted (`o.name = …`, `delete o.name`). */
  readonly propertyWriteSites: ReadonlyMap<string, readonly WriteSite[]>;
  /** Value each binding is declared with: its initializer, or the function a declaration creates. */
  readonly declaredValues: ReadonlyMap<string, ASTNode>;
  /** Every write to a binding, including implicit parameter, catch and for-in/of writes. */
  readonly writeSites: ReadonlyMap<string, readonly WriteSite[]>;
  /** Execution context (function or class element) in which each binding is declared. */
  readonly declaringContext: ReadonlyMap<string, string>;
  /** Where each call expression executes. */
  readonly callSites: ReadonlyMap<ASTNode, ExecutionSite>;
  /** Frame (with its enclosing frames) for each scope id, to resolve names as seen from a symbol's scope. */
  readonly scopeFrames: ReadonlyMap<string, ScopeFrame>;
  /** Binding keys whose declaration the symbol table places in the wrong scope (see collectUnscopedBindings). */
  readonly unscopedBindings: ReadonlySet<string>;
  /**
   * Binding keys, in every frame from a block up to its function, of names that a function declared in a nested
   * block or case also binds in the function (Annex B, non-strict code only): the outer name may hold that function.
   */
  readonly blockFunctionVars: ReadonlySet<string>;
}

interface SourcePoint {
  readonly line: number;
  readonly column: number;
}

interface ExecutionSite {
  /** Function, class field initializer or static block whose execution runs this code. */
  readonly contextId: string;
  /** Loops, within that context, that enclose this code. */
  readonly loopIds: readonly string[];
  readonly start: SourcePoint;
}

interface WriteSite extends ExecutionSite {
  readonly end: SourcePoint;
  /** False when the write has no source location and so cannot be ordered against a call. */
  readonly ordered: boolean;
  /** True when the write runs whenever its context reaches it: no branch, loop, try or short circuit. */
  readonly unconditional: boolean;
  /** `binding = new Class()` with an identifier class reference, resolved lazily. */
  readonly constructed?: { readonly className: string; readonly scope: ScopeFrame };
}

const MODULE_SCOPE_ID = "scope:module";
const classElementContexts = new Set(["ClassProperty", "ClassPrivateProperty", "PropertyDefinition", "ClassAccessorProperty", "StaticBlock"]);
const loopStatements = new Set(["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"]);

interface ScopeFrame {
  readonly id: string;
  readonly parent?: ScopeFrame;
  /** Name a named function or class expression binds to itself, visible only inside it. */
  readonly selfName?: string;
}

interface ResolutionContext {
  readonly callerName: string;
  readonly scope: ScopeFrame;
  readonly containerId?: string;
  readonly containerName?: string;
  readonly receiverTypes: ReadonlyMap<string, string | null>;
  readonly constantBindings: ReadonlyMap<string, string | null>;
  /** Inside a `with` body: the frame around the `with` statement (NA-02). */
  readonly withOuter?: ScopeFrame;
}

function createScope(id: string, parent?: ScopeFrame, selfName?: string): ScopeFrame {
  return immutable({ id, ...(parent === undefined ? {} : { parent }), ...(selfName === undefined ? {} : { selfName }) });
}

function createsScope(node: ASTNode): boolean {
  return node.type === "BlockStatement" || isCallable(node) || node.type === "CatchClause" || isLoop(node) || node.type === "TSModuleDeclaration"
    || node.type === "SwitchStatement" || node.type === "StaticBlock";
}

/**
 * Frame in which `node`'s own code runs. A named function or class expression binds its name
 * in a frame of its own between the enclosing frame and its body, where parameters and body
 * declarations can still shadow it. Frame ids match the symbol extractor's scope ids.
 */
function frameFor(node: ASTNode, enclosing: ScopeFrame): ScopeFrame {
  const selfName = node.type === "FunctionExpression" || node.type === "ClassExpression"
    ? identifier(node.children.find((child) => child.role === "id"))
    : undefined;
  const outer = selfName === undefined
    ? enclosing
    : createScope(createSelfScopeId(node.type, node.location), enclosing, selfName);
  return createsScope(node) ? createScope(createLexicalScopeId(node.type, node.location), outer) : outer;
}

function createFileSymbolIndex(table: SymbolTable | undefined, ast: ASTResult, unstableExportIds: ReadonlySet<string>): FileSymbolIndex {
  const byScopeAndName = new Map<string, CodeSymbol[]>();
  const byName = new Map<string, CodeSymbol[]>();
  const firstImportByName = new Map<string, CodeSymbol>();
  const classByLocation = new Map<string, CodeSymbol>();
  const byAnchor = new Map<string, CodeSymbol[]>();
  const classSymbols: CodeSymbol[] = [];
  const ownerSymbols: CodeSymbol[] = [];

  const namespaceBlocks: NamespaceBlocks = new Map();

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

  const lexicalBindings = createLexicalBindingIndex(ast, table, byAnchor, byScopeAndName);
  const declarationsByScopeAndName = bindingDeclarations(byScopeAndName, ast.root);
  const writes = collectBindingWrites(ast.root, declarationsByScopeAndName);
  const classes = collectClassFacts(ast.root, classSymbols);
  const reopened = reopenedNamespaces(namespaceBlocks);
  return immutable({ byScopeAndName, declarationsByScopeAndName, byName, firstImportByName, classByLocation, lexicalBindings, ownerSymbols, reopened, writes, unstableExportIds, classes, directEval: callsEvalDirectly(ast.root) });
}

const directEvalByRoot = new WeakMap<ASTNode, boolean>();

/** Whether the file has a direct `eval(…)` call; computed once per AST (NA-02). */
function callsEvalDirectly(root: ASTNode): boolean {
  const cached = directEvalByRoot.get(root);
  if (cached !== undefined) return cached;
  let found = false;
  const pending: ASTNode[] = [root];
  while (!found && pending.length > 0) {
    const node = pending.pop() as ASTNode;
    if (node.type === "CallExpression" || node.type === "OptionalCallExpression") {
      const callee = node.children.find((child) => child.role === "callee");
      found = callee?.type === "Identifier" && callee.attributes.name === "eval";
    }
    for (const child of node.children) pending.push(child);
  }
  directEvalByRoot.set(root, found);
  return found;
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

/** Whether `name` is unbound in this reopened-namespace block but declared in another block of it. */
function mayBelongToOtherBlock(index: FileSymbolIndex, scopeId: string, name: string): boolean {
  return index.reopened.get(scopeId)?.has(name) === true && (index.byScopeAndName.get(lexicalBindingKey(scopeId, name)) ?? []).length === 0;
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
    && !index.classes.decorated.has(classId) && (isStatic === undefined || fact.isStatic === isStatic);
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
 * byScopeAndName restricted to symbols that declare a binding: imports, classes, enums, namespaces,
 * functions and declared variables (declarators, parameters, catch parameters). Interfaces and type
 * aliases are type-only and declare none; they may share a name with a value. The extractor records
 * more under the same scope and name: members (methods, class properties, `o.p = …`, object
 * literal keys), export records, and `f = () => …` as a function named f, which writes f's
 * real declaration. Binding lookups that decide what a write or call refers to must skip
 * them, or a member named like a binding would stand in for that binding's declaration.
 */
function bindingDeclarations(byScopeAndName: ReadonlyMap<string, readonly CodeSymbol[]>, root: ASTNode): ReadonlyMap<string, readonly CodeSymbol[]> {
  const assignedFunctions = new Set<string>();
  const objectKeys = new Set<string>();
  const classExpressions = new Set<string>();
  const visit = (node: ASTNode): void => {
    if (node.type === "ClassExpression") {
      const anchor = declarationAnchor(node.location);
      if (anchor !== undefined) classExpressions.add(anchor);
    }
    if (node.type === "AssignmentExpression" && node.attributes.operator === "=") {
      let right = node.children.find((child) => child.role === "right");
      while (right?.type === "AssignmentExpression") right = right.children.find((child) => child.role === "right");
      const anchor = right?.type === "FunctionExpression" || right?.type === "ArrowFunctionExpression" ? declarationAnchor(right.location) : undefined;
      if (anchor !== undefined) assignedFunctions.add(anchor);
    }
    if (node.type === "ObjectExpression") {
      for (const property of node.children) {
        const anchor = declarationAnchor(property.location);
        if (anchor !== undefined) objectKeys.add(anchor);
      }
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  const declaresBinding = (symbol: CodeSymbol): boolean => {
    const anchor = declarationAnchor(symbol.location) ?? "";
    switch (symbol.kind) {
      case "import":
      case "enum":
      case "namespace":
        return true;
      case "class":
        // A class expression binds nothing in the scope around it: the `const` or key that holds it does.
        return !classExpressions.has(anchor);
      case "function":
        return !assignedFunctions.has(anchor);
      case "variable":
        // Members carry no declaration kind, except object literal keys.
        return symbol.declarationKind !== undefined && !objectKeys.has(anchor);
      default:
        return false;
    }
  };
  const declarations = new Map<string, readonly CodeSymbol[]>();
  for (const [key, symbols] of byScopeAndName) {
    const declared = symbols.filter(declaresBinding);
    if (declared.length > 0) declarations.set(key, declared);
  }
  return declarations;
}

/**
 * Export symbols of this module whose value can change after the module defines it: ES
 * exports whose local binding the module reassigns (importers see live bindings), and
 * CommonJS names exported more than once (`require` returns the last value). Re-exports
 * resolve to their declaring module and are judged there.
 */
export function collectUnstableExportIds(ast: ASTResult, table: SymbolTable | undefined): readonly string[] {
  if (table === undefined) return [];
  // A direct `eval` can reassign any binding of its module, so none of its exports is stable (NA-02).
  if (callsEvalDirectly(ast.root)) {
    return table.symbols
      .filter((symbol) => (symbol.kind === "export" && symbol.moduleSpecifier === undefined) || (symbol.exported && symbol.scopeId === MODULE_SCOPE_ID))
      .map((symbol) => symbol.id);
  }
  const byScopeAndName = new Map<string, CodeSymbol[]>();
  // An export slot is the module value itself (`module.exports =`, `export default`) or one named
  // property of it; `module.exports.default = f` names a property and does not replace the module value.
  const exportSlot = (symbol: CodeSymbol): string => `${symbol.defaultExport ? "module" : "property"}:${symbol.name}`;
  const exportsBySlot = new Map<string, number>();
  for (const symbol of table.symbols) {
    if (symbol.scopeId !== undefined) {
      const key = lexicalBindingKey(symbol.scopeId, symbol.name);
      byScopeAndName.set(key, [...(byScopeAndName.get(key) ?? []), symbol]);
    }
    if (symbol.kind === "export" && symbol.moduleSpecifier === undefined) exportsBySlot.set(exportSlot(symbol), (exportsBySlot.get(exportSlot(symbol)) ?? 0) + 1);
  }
  const { reboundBindings } = collectBindingWrites(ast.root, bindingDeclarations(byScopeAndName, ast.root));
  const rebound = (name: string | undefined): boolean => name !== undefined && reboundBindings.has(bindingWriteKey(MODULE_SCOPE_ID, name));
  return table.symbols.filter((symbol) => {
    if (symbol.kind === "export") {
      if (symbol.moduleSpecifier !== undefined) return false;
      // `export default <expression>` has no local binding to reassign.
      const local = symbol.sourceSymbolName ?? (symbol.defaultExport ? undefined : symbol.name);
      return (exportsBySlot.get(exportSlot(symbol)) ?? 0) > 1 || rebound(local);
    }
    return symbol.exported && symbol.scopeId === MODULE_SCOPE_ID && rebound(symbol.name);
  }).map((symbol) => symbol.id);
}

function isUnstableTarget(index: FileSymbolIndex, targetSymbolId: string | undefined): boolean {
  return targetSymbolId !== undefined && index.unstableExportIds.has(targetSymbolId);
}

interface WriteWalk {
  readonly scope: ScopeFrame;
  readonly contextId: string;
  readonly loopIds: readonly string[];
  readonly unconditional: boolean;
}

/**
 * Records every write that can change which function a binding or property names,
 * with where and under which control it executes. Scope frames mirror `childContext`,
 * so keys match the resolver's binding keys. Assumes no `eval`/`with`, no mutation of
 * this module's objects by other modules (including property-copying helpers such as
 * `mixin` or `_.extend`), and that the `Object`/`Reflect` builtins are not reached
 * through other objects (`globalThis.Object`).
 */
function collectBindingWrites(root: ASTNode, byScopeAndName: ReadonlyMap<string, readonly CodeSymbol[]>): BindingWrites {
  const reboundBindings = new Set<string>();
  const declarations = new Map<string, number>();
  const propertyWrites = new Map<string, number>();
  let unknownPropertyWrites = false;
  const propertyWriteSites = new Map<string, WriteSite[]>();
  const declaredValues = new Map<string, ASTNode>();
  const writeSites = new Map<string, WriteSite[]>();
  const declaringContext = new Map<string, string>();
  const callSites = new Map<ASTNode, ExecutionSite>();
  const scopeFrames = new Map<string, ScopeFrame>();

  const bindingKeyAt = (name: string, scope: ScopeFrame): string => {
    for (let current: ScopeFrame | undefined = scope; current !== undefined; current = current.parent) {
      if ((byScopeAndName.get(lexicalBindingKey(current.id, name)) ?? []).length > 0 || current.selfName === name) return bindingWriteKey(current.id, name);
    }
    return bindingWriteKey(scope.id, name);
  };
  const unscopedBindings = collectUnscopedBindings(root, bindingKeyAt);
  const blockFunctionVars = collectBlockFunctionVars(root, bindingKeyAt);
  const recordSite = (sitesByKey: Map<string, WriteSite[]>, key: string, site: ASTNode, walk: WriteWalk, constructed?: WriteSite["constructed"]): void => {
    const sites = sitesByKey.get(key) ?? [];
    sitesByKey.set(key, sites);
    const location = site.location;
    sites.push({
      contextId: walk.contextId,
      loopIds: walk.loopIds,
      start: location?.start ?? { line: 0, column: 0 },
      end: location?.end ?? { line: 0, column: 0 },
      ordered: location !== undefined,
      unconditional: walk.unconditional,
      ...(constructed === undefined ? {} : { constructed }),
    });
  };
  const recordWrite = (key: string, site: ASTNode, walk: WriteWalk, constructed?: WriteSite["constructed"]): void => {
    recordSite(writeSites, key, site, walk, constructed);
  };
  const declare = (name: string, site: ASTNode, walk: WriteWalk, initialized: boolean, constructed?: WriteSite["constructed"]): void => {
    const key = bindingKeyAt(name, walk.scope);
    if (!declaringContext.has(key)) declaringContext.set(key, walk.contextId);
    if (!initialized) return;
    const count = (declarations.get(key) ?? 0) + 1;
    declarations.set(key, count);
    if (count > 1) reboundBindings.add(key);
    recordWrite(key, site, walk, constructed);
  };
  const writeProperty = (name: string | undefined): void => {
    // `__proto__` swaps the prototype, so it may change every inherited method.
    if (name === undefined || name === "__proto__") {
      unknownPropertyWrites = true;
      return;
    }
    propertyWrites.set(name, (propertyWrites.get(name) ?? 0) + 1);
  };
  const writeObjectKeys = (source: ASTNode | undefined): void => {
    if (source?.type !== "ObjectExpression") {
      unknownPropertyWrites = true;
      return;
    }
    for (const property of source.children) {
      writeProperty(property.type === "ObjectProperty" || property.type === "ObjectMethod" ? propertyKeyName(property) : undefined);
    }
  };
  const write = (target: ASTNode | undefined, site: ASTNode, walk: WriteWalk, constructed?: WriteSite["constructed"]): void => {
    if (target === undefined) return;
    switch (target.type) {
      case "Identifier": {
        const name = identifier(target);
        if (name === undefined) return;
        const key = bindingKeyAt(name, walk.scope);
        reboundBindings.add(key);
        recordWrite(key, site, walk, constructed);
        if (unscopedBindings.has(key)) {
          // The binding found here may really be out of scope, so the write may reach any outer same-named binding.
          for (let current = walk.scope.parent; current !== undefined; current = current.parent) {
            reboundBindings.add(bindingWriteKey(current.id, name));
            recordWrite(bindingWriteKey(current.id, name), site, walk);
          }
        }
        return;
      }
      case "TSAsExpression":
      case "TSSatisfiesExpression":
      case "TSNonNullExpression":
      case "TSTypeAssertion":
      case "ParenthesizedExpression":
        write(target.children.find((child) => child.role === "expression"), site, walk, constructed);
        return;
      case "MemberExpression":
      case "OptionalMemberExpression": {
        const name = memberPropertyName(target);
        writeProperty(name);
        if (name !== undefined) recordSite(propertyWriteSites, name, site, walk);
        return;
      }
      case "AssignmentPattern":
        write(target.children.find((child) => child.role === "left"), site, walk);
        return;
      case "RestElement":
        write(target.children.find((child) => child.role === "argument"), site, walk);
        return;
      case "ObjectPattern":
        for (const property of target.children) {
          if (property.type === "RestElement") write(property, site, walk);
          else if (property.type === "ObjectProperty") write(property.children.find((child) => child.role === "value") ?? property.children.find((child) => child.role === "key"), site, walk);
        }
        return;
      case "ArrayPattern":
        for (const element of target.children) write(element, site, walk);
        return;
      default:
        return;
    }
  };
  const constructedBy = (value: ASTNode | undefined, scope: ScopeFrame): WriteSite["constructed"] => {
    if (value?.type !== "NewExpression") return undefined;
    const className = identifier(value.children.find((child) => child.role === "callee"));
    return className === undefined ? undefined : { className, scope };
  };

  const visit = (node: ASTNode, walk: WriteWalk, parent: ASTNode | undefined): void => {
    const scope = frameFor(node, walk.scope);
    if (!scopeFrames.has(scope.id)) scopeFrames.set(scope.id, scope);
    // Functions and class element initializers run whenever they are invoked, not in place.
    const opensContext = isCallable(node) || classElementContexts.has(node.type);
    const contextId = opensContext ? `context:${node.type}:${node.location?.start.line ?? 0}:${node.location?.start.column ?? 0}` : walk.contextId;
    const loopIds = opensContext ? [] : loopStatements.has(node.type)
      ? [...walk.loopIds, `loop:${node.location?.start.line ?? 0}:${node.location?.start.column ?? 0}`]
      : walk.loopIds;
    const inner: WriteWalk = { scope, contextId, loopIds, unconditional: opensContext || (walk.unconditional && !loopStatements.has(node.type)) };

    if (node.type === "CallExpression" || node.type === "OptionalCallExpression" || node.type === "NewExpression") {
      if (node.location !== undefined) callSites.set(node, { contextId: walk.contextId, loopIds: walk.loopIds, start: node.location.start });
    }
    if (node.type === "CallExpression" || node.type === "OptionalCallExpression") {
      const callee = node.children.find((child) => child.role === "callee");
      const args = node.children.filter((child) => child.role === "arguments");
      const writer = callee === undefined ? undefined : reflectiveWriterName(callee);
      if (writer !== undefined && args.some((arg) => arg.type === "SpreadElement")) {
        unknownPropertyWrites = true;
      } else if (writer === "Object.assign") {
        // Filling a fresh object cannot replace a method of an existing one.
        if (!isFreshObject(args[0])) for (const source of args.slice(1)) writeObjectKeys(source);
      } else if (writer === "Object.defineProperties") {
        writeObjectKeys(args[1]);
      } else if (writer === "Object.setPrototypeOf" || writer === "Reflect.setPrototypeOf") {
        unknownPropertyWrites = true;
      } else if (writer !== undefined) {
        writeProperty(staticPropertyKey(args[1]));
      }
      const property = callee?.type === "MemberExpression" || callee?.type === "OptionalMemberExpression" ? memberPropertyName(callee) : undefined;
      if (property === "__defineGetter__" || property === "__defineSetter__") writeProperty(staticPropertyKey(args[0]));
    }
    // Object/Reflect writers reached any other way (aliased, passed on, `.call`) are untracked writes.
    if (escapesReflectiveWriters(node, parent)) unknownPropertyWrites = true;
    if (node.type === "UnaryExpression" && node.attributes.operator === "delete") {
      const argument = node.children.find((child) => child.role === "argument");
      if (argument?.type === "MemberExpression" || argument?.type === "OptionalMemberExpression") write(argument, node, walk);
    }
    if (node.type === "AssignmentExpression") {
      const left = node.children.find((child) => child.role === "left");
      const constructed = node.attributes.operator === "=" ? constructedBy(node.children.find((child) => child.role === "right"), scope) : undefined;
      // `&&=`, `||=` and `??=` store only when the current value lets them.
      const logical = ["&&=", "||=", "??="].includes(String(node.attributes.operator));
      write(left, node, logical ? { ...walk, unconditional: false } : walk, left?.type === "Identifier" ? constructed : undefined);
    }
    if (classFieldTypes.has(node.type)) {
      // A field is an own property of every instance (or of the class, if static): it hides a method of that name.
      writeProperty(classElementName(node));
    }
    if (node.type === "UpdateExpression") write(node.children.find((child) => child.role === "argument"), node, walk);
    if (node.type === "ForInStatement" || node.type === "ForOfStatement") {
      const left = node.children.find((child) => child.role === "left");
      if (left?.type === "VariableDeclaration") {
        // Each iteration initializes the loop binding from the iterated value.
        for (const declarator of left.children.filter((child) => child.role === "declarations")) {
          for (const name of extractBoundNames(declarator.children.find((child) => child.role === "id"))) declare(name, declarator, inner, true);
        }
      } else {
        write(left, node, inner);
      }
    }
    // for-in/of loop declarations are written above; without an initializer this only records the declaration.
    if (node.type === "VariableDeclarator" && parent?.type === "VariableDeclaration") {
      const init = node.children.find((child) => child.role === "init");
      const id = node.children.find((child) => child.role === "id");
      for (const name of extractBoundNames(id)) {
        declare(name, node, walk, init !== undefined, id?.type === "Identifier" ? constructedBy(init, scope) : undefined);
        if (id?.type === "Identifier" && init !== undefined) declaredValues.set(bindingKeyAt(name, walk.scope), init);
      }
    }
    if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") {
      const name = nodeName(node);
      if (name !== undefined) declare(name, node, walk, true);
      if (name !== undefined && node.type === "FunctionDeclaration") declaredValues.set(bindingKeyAt(name, walk.scope), node);
    }
    if (isCallable(node)) {
      // Parameters are written by every call with the caller's arguments.
      for (const param of node.children.filter((child) => child.role === "param" || child.role === "params")) {
        for (const name of extractBoundNames(param)) declare(name, param, inner, true);
      }
    }
    if (node.type === "CatchClause") {
      const param = node.children.find((child) => child.role === "param");
      for (const name of extractBoundNames(param)) declare(name, param ?? node, { ...inner, unconditional: false }, true);
    }

    for (const child of node.children) {
      visit(child, { ...inner, unconditional: inner.unconditional && !isConditionalChild(node, child) }, node);
    }
  };
  visit(root, { scope: createScope(MODULE_SCOPE_ID), contextId: MODULE_SCOPE_ID, loopIds: [], unconditional: true }, undefined);
  return immutable({ reboundBindings, propertyWrites, unknownPropertyWrites, propertyWriteSites, declaredValues, writeSites, declaringContext, callSites, scopeFrames, unscopedBindings, blockFunctionVars });
}

const classFieldTypes = new Set(["ClassProperty", "ClassPrivateProperty", "PropertyDefinition", "ClassAccessorProperty"]);

/**
 * Binding keys of declarations whose real scope the symbol table does not model, so a name
 * resolved to them may mean another binding: `var` or function declarations in a function with
 * parameter expressions (which see the parameter scope, not the body).
 */
function collectUnscopedBindings(root: ASTNode, bindingKeyAt: (name: string, scope: ScopeFrame) => string): ReadonlySet<string> {
  const unscoped = new Set<string>();
  const declaredNames = (statement: ASTNode, includeVar: boolean): string[] => {
    if (statement.type === "VariableDeclaration" && (includeVar || statement.attributes.kind !== "var")) {
      return statement.children.filter((child) => child.role === "declarations").flatMap((declarator) => extractBoundNames(declarator.children.find((child) => child.role === "id")));
    }
    if (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") {
      const name = nodeName(statement);
      return name === undefined ? [] : [name];
    }
    return [];
  };
  const functionScopedNames = (node: ASTNode): string[] => {
    const names: string[] = [];
    const visit = (current: ASTNode): void => {
      if (current !== node && (isCallable(current) || current.type === "ClassDeclaration" || current.type === "ClassExpression")) {
        if (current.type === "FunctionDeclaration") names.push(...declaredNames(current, true));
        return;
      }
      if (current.type === "VariableDeclaration" && current.attributes.kind === "var") names.push(...declaredNames(current, true));
      for (const child of current.children) visit(child);
    };
    for (const child of node.children.filter((candidate) => candidate.role === "body")) visit(child);
    return names;
  };
  const visit = (node: ASTNode, scope: ScopeFrame): void => {
    const inner = frameFor(node, scope);
    if (isCallable(node) && node.children.some((child) => (child.role === "params" || child.role === "param") && hasParameterExpression(child))) {
      for (const name of functionScopedNames(node)) unscoped.add(bindingKeyAt(name, inner));
    }
    for (const child of node.children) visit(child, inner);
  };
  visit(root, createScope(MODULE_SCOPE_ID));
  return unscoped;
}

function hasUseStrict(node: ASTNode | undefined): boolean {
  return node?.children.some((child) => child.type === "Directive" && child.children.some((literal) => literal.attributes.value === "use strict")) === true;
}

/**
 * In sloppy code a function declared in a nested block or case also creates a var binding in the enclosing
 * function (Annex B.3.3), so the same name read outside the block may be that function. Strict code (an ES module,
 * a "use strict" directive, a class body) keeps the declaration block-scoped. Strictness is read from the module
 * source type and the directives, which the parser reports; a function whose strictness cannot be read as strict
 * is treated as sloppy, never the reverse.
 */
function collectBlockFunctionVars(root: ASTNode, bindingKeyAt: (name: string, scope: ScopeFrame) => string): ReadonlySet<string> {
  const names = new Set<string>();
  const visit = (node: ASTNode, scope: ScopeFrame, functionFrame: ScopeFrame, strict: boolean, parent?: ASTNode, grandparent?: ASTNode): void => {
    const inner = frameFor(node, scope);
    const isFunction = isCallable(node) || node.type === "StaticBlock";
    const nestedStrict = strict || node.type === "ClassDeclaration" || node.type === "ClassExpression"
      || (node.type === "Program" && (node.attributes.sourceType === "module" || hasUseStrict(node)))
      || (isCallable(node) && hasUseStrict(node.children.find((child) => child.role === "body")));
    if (node.type === "FunctionDeclaration" && !strict && parent !== undefined) {
      const functionBody = parent.type === "BlockStatement" && parent.role === "body" && grandparent !== undefined && (isCallable(grandparent) || grandparent.type === "StaticBlock");
      const inBlock = (parent.type === "BlockStatement" && !functionBody) || parent.type === "SwitchCase";
      const name = nodeName(node);
      if (inBlock && name !== undefined) {
        for (let frame: ScopeFrame | undefined = scope.parent; frame !== undefined; frame = frame.parent) {
          names.add(bindingKeyAt(name, frame));
          if (frame === functionFrame) break;
        }
      }
    }
    for (const child of node.children) visit(child, inner, isFunction ? inner : functionFrame, nestedStrict, node, parent);
  };
  const module = createScope(MODULE_SCOPE_ID);
  visit(root, module, module, false);
  return names;
}

function hasParameterExpression(node: ASTNode): boolean {
  return node.type === "AssignmentPattern" || (node.type === "ObjectProperty" && node.attributes.computed === true) || node.children.some(hasParameterExpression);
}

const reflectiveWriters = new Set([
  "Object.assign", "Object.defineProperty", "Object.defineProperties", "Object.setPrototypeOf",
  "Reflect.set", "Reflect.defineProperty", "Reflect.deleteProperty", "Reflect.setPrototypeOf",
]);
const reflectiveNamespaces = new Set(["Object", "Reflect"]);

/** `Object.assign`-style builtin named directly by a member expression. */
function reflectiveWriterName(node: ASTNode): string | undefined {
  if ((node.type !== "MemberExpression" && node.type !== "OptionalMemberExpression") || node.attributes.computed === true) return undefined;
  const namespace = node.children.find((child) => child.role === "object");
  const name = `${namespace?.type === "Identifier" ? identifier(namespace) : ""}.${identifier(node.children.find((child) => child.role === "property")) ?? ""}`;
  return reflectiveWriters.has(name) ? name : undefined;
}

/**
 * True when `node` hands a reflective writer to code this walk cannot follow: `Object` or
 * `Reflect` used other than as `Object.member`, or a writer used other than as a direct callee.
 */
function escapesReflectiveWriters(node: ASTNode, parent: ASTNode | undefined): boolean {
  if (node.type === "Identifier" && reflectiveNamespaces.has(identifier(node) ?? "")) {
    if (parent === undefined || parent.type.startsWith("TS")) return false;
    const isMember = parent.type === "MemberExpression" || parent.type === "OptionalMemberExpression";
    if (isMember && parent.attributes.computed !== true && (node.role === "object" || node.role === "property")) return false;
    if (node.role === "key" && parent.attributes.computed !== true) return false;
    return true;
  }
  if (reflectiveWriterName(node) === undefined) return false;
  return !((parent?.type === "CallExpression" || parent?.type === "OptionalCallExpression") && node.role === "callee");
}

/** Static name of the property a member expression reads or writes: `#name` for private names. */
function memberPropertyName(member: ASTNode): string | undefined {
  const property = member.children.find((child) => child.role === "property");
  if (member.attributes.computed === true) return staticPropertyKey(property);
  if (property?.type === "PrivateName") {
    const name = identifier(property);
    return name === undefined ? undefined : `#${name}`;
  }
  return identifier(property);
}

/** Name of a class member or field: `#name` for private names. */
function classElementName(element: ASTNode): string | undefined {
  const key = element.children.find((child) => child.role === "key");
  if (key?.type !== "PrivateName") return propertyKeyName(element);
  const name = identifier(key);
  return name === undefined ? undefined : `#${name}`;
}

function propertyKeyName(property: ASTNode): string | undefined {
  const key = property.children.find((child) => child.role === "key");
  return property.attributes.computed === true ? staticPropertyKey(key) : key?.type === "Identifier" ? identifier(key) : staticPropertyKey(key);
}

function staticPropertyKey(node: ASTNode | undefined): string | undefined {
  if (node?.type === "NumericLiteral" && typeof node.attributes.value === "number") return String(node.attributes.value);
  return extractStaticString(node);
}

function isFreshObject(node: ASTNode | undefined): boolean {
  return node?.type === "ObjectExpression" || node?.type === "ArrayExpression";
}

/** Children that run only on some executions of their parent, or not in source order. */
function isConditionalChild(parent: ASTNode, child: ASTNode): boolean {
  switch (parent.type) {
    case "IfStatement":
    case "ConditionalExpression":
      return child.role === "consequent" || child.role === "alternate";
    case "LogicalExpression":
    case "AssignmentPattern":
      return child.role === "right";
    case "AssignmentExpression":
      return child.role === "right" && ["&&=", "||=", "??="].includes(String(parent.attributes.operator));
    case "SwitchStatement":
      return child.role === "cases";
    case "TryStatement":
    case "CatchClause":
      return true;
    case "LabeledStatement":
      return child.role === "body";
    case "OptionalMemberExpression":
    case "OptionalCallExpression":
      return child.role !== "object" && child.role !== "callee";
    default:
      return false;
  }
}

function comparePoints(left: SourcePoint, right: SourcePoint): number {
  return left.line - right.line || left.column - right.column;
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
 * Frame that declares `name` as seen from `scope`. Undeclared (global) names have none:
 * any script can write them, so no value-derived target through them is proven. Neither
 * has a function or class expression's own name, nor a declaration the symbol table places
 * in the wrong scope: what such a name holds there is not modeled.
 */
function declaredBindingFrame(index: FileSymbolIndex, name: string, scope: ScopeFrame): ScopeFrame | undefined {
  for (let current: ScopeFrame | undefined = scope; current !== undefined; current = current.parent) {
    if (current.selfName === name) return undefined;
    if (mayBelongToOtherBlock(index, current.id, name)) return undefined;
    if (index.writes.blockFunctionVars.has(bindingWriteKey(current.id, name))) return undefined;
    if ((index.declarationsByScopeAndName.get(lexicalBindingKey(current.id, name)) ?? []).length > 0) {
      return index.writes.unscopedBindings.has(bindingWriteKey(current.id, name)) ? undefined : current;
    }
  }
  return undefined;
}

function bindingWriteKey(scopeId: string, name: string): string {
  return `${scopeId}:${name}`;
}

function isRebound(index: FileSymbolIndex, scopeId: string, name: string): boolean {
  return index.writes.reboundBindings.has(bindingWriteKey(scopeId, name));
}

type LexicalResolution =
  | { readonly state: "NO_BINDING" }
  | { readonly state: "BLOCKED_AMBIGUOUS" }
  | {
      readonly state: "ONE_BINDING";
      readonly canonical: CodeSymbol;
      readonly referenceTargets: readonly CodeSymbol[];
    };

interface LexicalBinding {
  readonly canonical: CodeSymbol;
  readonly referenceTargets: readonly CodeSymbol[];
}

function declarationAnchor(location: CodeSymbol["location"]): string | undefined {
  if (location === undefined) return undefined;
  return `${location.start.line}:${location.start.column}:${location.end.line}:${location.end.column}`;
}

// Match only the CommonJS initializer forms already recognized by the extractor.
function commonJsInitializerSpecifier(node: ASTNode | undefined): string | undefined {
  if (node?.type === "MemberExpression") return commonJsInitializerSpecifier(node.children.find(child => child.role === "object"));
  if (node?.type !== "CallExpression") return undefined;
  const callee = node.children.find(child => child.role === "callee");
  const argument = node.children.find(child => child.role === "arguments");
  if (identifier(callee) !== "require" || argument?.type !== "StringLiteral") return undefined;
  const value = argument.attributes.value;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

// Associate existing records once per file. A shared name is never an association.
function createLexicalBindingIndex(
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

function resolveLexicalBinding(index: FileSymbolIndex, name: string, scope: ScopeFrame): LexicalResolution {
  for (let current: ScopeFrame | undefined = scope; current !== undefined; current = current.parent) {
    if (current.selfName === name) return { state: "NO_BINDING" };
    const resolution = index.lexicalBindings.get(lexicalBindingKey(current.id, name));
    if (resolution !== undefined && resolution.state !== "NO_BINDING") return resolution;
    if (mayBelongToOtherBlock(index, current.id, name)) return { state: "BLOCKED_AMBIGUOUS" };
  }
  return { state: "NO_BINDING" };
}

function lexicalBindingKey(scopeId: string, name: string): string {
  return `${scopeId}\u0000${name}`;
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
  return {
    callerName,
    scope,
    ...(containerId === undefined ? {} : { containerId }),
    ...(containerName === undefined ? {} : { containerName }),
    receiverTypes: context.receiverTypes,
    constantBindings: context.constantBindings,
    ...(context.withOuter === undefined ? {} : { withOuter: context.withOuter }),
  };
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

function isCallable(node: ASTNode): boolean {
  return ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ClassMethod", "ClassPrivateMethod", "ObjectMethod"].includes(node.type);
}

function isLoop(node: ASTNode): boolean {
  return ["ForStatement", "ForInStatement", "ForOfStatement"].includes(node.type);
}

function nodeName(node: ASTNode): string | undefined {
  return identifier(node.children.find((child) => child.role === "id" || child.role === "key")) ?? identifier(node);
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

function identifier(node: ASTNode | undefined): string | undefined {
  if (node === undefined) return undefined;
  const value = node.attributes.name;
  if (typeof value === "string") return value;
  const idChild = node.children.find((child) => child.role === "id" || child.role === "key");
  if (idChild !== undefined) {
    const childVal = idChild.attributes.name;
    if (typeof childVal === "string") return childVal;
  }
  return undefined;
}

function extractBoundNames(node: ASTNode | undefined): string[] {
  if (node === undefined) return [];
  if (node.type === "Identifier") {
    const name = identifier(node);
    return name === undefined ? [] : [name];
  }
  if (node.type === "AssignmentPattern") {
    const left = node.children.find((child) => child.role === "left");
    return extractBoundNames(left);
  }
  if (node.type === "RestElement") {
    const argument = node.children.find((child) => child.role === "argument");
    return extractBoundNames(argument);
  }
  if (node.type === "TSParameterProperty") {
    // `constructor(private svc)` binds svc like any other parameter.
    return extractBoundNames(node.children.find((child) => child.role === "parameter"));
  }
  if (node.type === "ObjectPattern") {
    const names: string[] = [];
    for (const child of node.children) {
      if (child.type === "ObjectProperty") {
        const val = child.children.find((c) => c.role === "value") ?? child.children.find((c) => c.role === "key");
        names.push(...extractBoundNames(val));
      } else if (child.type === "RestElement") {
        names.push(...extractBoundNames(child));
      }
    }
    return names;
  }
  if (node.type === "ArrayPattern") {
    const names: string[] = [];
    for (const child of node.children) {
      names.push(...extractBoundNames(child));
    }
    return names;
  }
  return [];
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

function extractStaticString(node: ASTNode | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (node.type === "StringLiteral") {
    return typeof node.attributes.value === "string" ? node.attributes.value : undefined;
  }
  if (node.type === "TemplateLiteral") {
    const hasExpressions = node.children.some((c) => c.role === "expressions");
    if (hasExpressions) return undefined;
    const quasi = node.children.find((c) => c.role === "quasis" || c.type === "TemplateElement");
    if (quasi !== undefined && typeof quasi.attributes.value === "string") {
      return quasi.attributes.value;
    }
    return "";
  }
  return undefined;
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

function bindingKey(scope: ScopeFrame, name: string): string {
  return `${scope.id}:${name}`;
}

/**
 * The import that `name` names at `scope`. The symbol table files every `require` as a module
 * import, even one inside a function, so the import counts only where it is the visible binding.
 */
function visibleImport(index: FileSymbolIndex, name: string, scope: ScopeFrame): CodeSymbol | undefined {
  const imported = index.firstImportByName.get(name);
  if (imported === undefined) return undefined;
  const binding = resolveLexicalBinding(index, name, scope);
  return binding.state === "ONE_BINDING" && binding.referenceTargets.some((target) => target.id === imported.id) ? imported : undefined;
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
  if (importSymbol.moduleSpecifier === undefined) return undefined;
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

/** Writes that may replace `propertyName`; dynamic and reflective writes cannot reach private names. */
function propertyWriteCount(index: FileSymbolIndex, propertyName: string): number {
  const writes = index.writes.propertyWrites.get(propertyName) ?? 0;
  return index.writes.unknownPropertyWrites && !propertyName.startsWith("#") ? Number.POSITIVE_INFINITY : writes;
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
    // No other write may replace it: a field's own initializer is the one permitted write.
    if (candidate !== undefined && propertyWriteCount(index, methodName) === ownPropertyWrites(index, candidate)) return candidate.id;
  }

  // 2. Object container method (e.g. app.init after `app.init = function …`): the container
  //    binding never changes, the property is declared once on that same binding and never
  //    otherwise written, and the call cannot run before the definition takes effect.
  const containerFrame = receiver === "this" ? undefined : declaredBindingFrame(index, receiver, context.scope);
  if (containerFrame !== undefined && !isRebound(index, containerFrame.id, receiver)) {
    const declared = (index.byName.get(methodName) ?? []).filter(
      (symbol) => symbol.containerName === receiver && isDefinedOnBinding(index, symbol, receiver, containerFrame),
    );
    const candidates = declared.filter((symbol) => symbol.kind === "method" || symbol.kind === "function");
    const candidate = candidates.length === 1 && declared.length === 1 ? candidates[0] : undefined;
    // A member-assigned definition is itself the one permitted write; a class member admits none
    // and, called on the class, must be a static method declared in its body.
    if (candidate !== undefined && propertyWriteCount(index, methodName) === (candidate.containerId === undefined ? 1 : ownPropertyWrites(index, candidate))) {
      if (candidate.containerId !== undefined
        ? isClassBodyMethod(index, candidate, candidate.containerId, true)
        : isDefinedBeforeCall(index, candidate, receiver, containerFrame, callNode)) return candidate.id;
    }
  }

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

function isLexicallyShadowed(name: string, context: ResolutionContext, index: FileSymbolIndex): boolean {
  for (let current: ScopeFrame | undefined = context.scope; current !== undefined; current = current.parent) {
    if (current.id === "scope:module") {
      break;
    }
    if (current.selfName === name || context.receiverTypes.has(receiverKey(current, name)) || mayBelongToOtherBlock(index, current.id, name)) {
      return true;
    }
    if (context.constantBindings.has(bindingKey(current, name))) {
      return true;
    }
    if ((index.byScopeAndName.get(lexicalBindingKey(current.id, name)) ?? []).length > 0) {
      return true;
    }
  }
  return false;
}

function receiverKey(scope: ScopeFrame, name: string): string {
  return `${scope.id}:${name}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
