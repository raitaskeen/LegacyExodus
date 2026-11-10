import type { ASTNode, ASTResult } from "@parser/index";
import type { CodeSymbol, SymbolTable } from "@symbols/index";
import { canonicalizePath } from "@graph/index";

/**
 * Phase C1 (audits/2026-11-10-blind-audit/PHASE-C-DESIGN.md): an object a repository factory builds and returns.
 *
 * `function fastify () { const fastify = { get: function _get () {}, inject: inject }; …; return fastify }` returns, on
 * every path, the one object literal bound to `fastify`. A call `app.get()` with `const app = fastify()` reaches that
 * literal's `get` when nothing replaces it. Each file contributes its factories while its AST and symbol table are at
 * hand; the index answers which function a factory's property names.
 *
 * Assumptions, stated in Current Implementation: a computed key or computed write (`fastify[kState] = …`) does not
 * produce a method's name, as for `this.m()`; reflection (`Object.defineProperty`, `Object.assign` onto the object) is
 * not followed. A property written by name anywhere in the factory's file, on any object, is left out, and a name some
 * other file writes on any object other than `this` and its own exports is never resolved through a factory.
 */
export interface FactoryFact {
  /** The factory's function symbol and every export of its file that names it. */
  readonly ids: readonly string[];
  /** Property name to the symbol of the function it holds. */
  readonly methods: readonly (readonly [string, string])[];
  /**
   * Phase C2: the methods belong to `new F()`'s instance, through `F.prototype`, not to `F()`'s result. Set for a
   * constructor function whose prototype is never replaced or passed to a call, whose body returns no value, and
   * that is never passed to a call itself (`util.inherits(F, Base)` could give an early call another target).
   */
  readonly constructed?: true;
  /**
   * Phase C2b: where the constructor has a parent, the end of its last top-level prototype method write. Before it, a
   * call could reach the parent's method of the same name, so a top-level call of the same file that starts earlier is
   * not resolved. A call inside a function is assumed to run after the module has loaded.
   */
  readonly readyAt?: { readonly line: number; readonly column: number };
  /**
   * Phase C3b: the factory copies properties onto the object it returns, in this order (see CopyFact). Set only when
   * every copy's source has known names; `literalNames` are the object's own keys before the copies, `function` says
   * the object is a function (own `length`, `name`, `prototype`), and `writtenHere` are the names the factory's file
   * writes by name, which no copy may be trusted for.
   */
  readonly copies?: readonly CopyFact[];
  readonly literalNames?: readonly string[];
  readonly function?: true;
  readonly writtenHere?: readonly string[];
}

/**
 * Phase C3b: one copy of own properties onto a factory's object, `mergeDescriptors(o, source, overwrite)` (the
 * `merge-descriptors` package; `overwrite` defaults to true, and false keeps a property `o` already has) or
 * `Object.assign(o, source)` (overwrites). The source is a repository module's exports object (C3a facts give its
 * names) or a known built-in prototype.
 */
export interface CopyFact {
  readonly overwrite: boolean;
  readonly module?: { readonly importer: string; readonly specifier: string };
  readonly external?: { readonly module: string; readonly member: string };
}

/**
 * Own property names of built-in prototypes a copy may take from (Node 18 and later). An assumption about the runtime,
 * stated in Current Implementation.
 */
const KNOWN_PROTOTYPES: Readonly<Record<string, ReadonlySet<string>>> = {
  "events:EventEmitter.prototype": new Set(["constructor", "_events", "_eventsCount", "_maxListeners", "setMaxListeners", "getMaxListeners", "emit",
    "addListener", "on", "prependListener", "once", "prependOnceListener", "removeListener", "off", "removeAllListeners", "listeners", "rawListeners",
    "listenerCount", "eventNames"]),
};

/** Own properties every function has: a copy that does not overwrite leaves them alone. */
const FUNCTION_OWN = new Set(["length", "name", "prototype", "arguments", "caller"]);

export interface FactoryFile {
  readonly filePath: string;
  readonly factories: readonly FactoryFact[];
  /**
   * Phase C3a: functions the file's exports object holds by name, when `module.exports` is one object literal or an
   * object the file names and fills (`var app = exports = module.exports = {}; app.use = function …`). Name to symbol.
   */
  readonly exportMembers?: readonly (readonly [string, string])[];
  /** Phase C3b: every name the exports object holds (functions or not), when the file builds it plainly. */
  readonly exportNames?: readonly string[];
  /**
   * Phase C3b: `module.exports = require("./x")`, the file's only write of `module.exports`: a call through this file's
   * default export reaches x's default export. The ids are this file's default export symbols.
   */
  readonly reexportsDefault?: { readonly exportIds: readonly string[]; readonly specifier: string };
  /** Phase C3b: the factory ids that are this file's one default export (`module.exports = createApplication`). */
  readonly defaultFactoryIds?: readonly string[];
}

const FUNCTION_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ObjectMethod", "ClassMethod", "ClassPrivateMethod"]);

function nameOf(node: ASTNode | undefined): string | undefined {
  return typeof node?.attributes.name === "string" ? node.attributes.name : undefined;
}

function role(node: ASTNode, name: string): ASTNode | undefined {
  return node.children.find((child) => child.role === name);
}

function startKey(location: { readonly start: { readonly line: number; readonly column: number } } | undefined): string | undefined {
  return location === undefined ? undefined : `${location.start.line}:${location.start.column}`;
}

/** Visits `node`'s subtree without entering nested functions (their returns and bindings are their own). */
function walkOwn(node: ASTNode, visit: (node: ASTNode) => void): void {
  visit(node);
  for (const child of node.children) if (!FUNCTION_TYPES.has(child.type)) walkOwn(child, visit);
}

function walkAll(node: ASTNode, visit: (node: ASTNode) => void): void {
  visit(node);
  for (const child of node.children) walkAll(child, visit);
}

/** A property key's name: an identifier, a string, or a computed string literal. A computed expression has none. */
function keyName(property: ASTNode): string | undefined {
  const key = role(property, "key");
  if (key === undefined) return undefined;
  if (property.attributes.computed === true) return key.type === "StringLiteral" && typeof key.attributes.value === "string" ? key.attributes.value : undefined;
  if (key.type === "StringLiteral" && typeof key.attributes.value === "string") return key.attributes.value;
  return nameOf(key);
}

/** One file's factories: functions whose every return gives the same local object literal binding. */
export function collectFactoryFacts(ast: ASTResult, table: SymbolTable | undefined): FactoryFile {
  const filePath = canonicalizePath(ast.metadata.sourcePath);
  const symbols = table?.symbols ?? [];
  const byStart = new Map<string, CodeSymbol[]>();
  const functionsByName = new Map<string, CodeSymbol[]>();
  for (const symbol of symbols) {
    const key = startKey(symbol.location);
    if (key !== undefined) byStart.set(key, [...(byStart.get(key) ?? []), symbol]);
    if (symbol.kind === "function") functionsByName.set(symbol.name, [...(functionsByName.get(symbol.name) ?? []), symbol]);
  }
  // Names the file writes by name on any object, `this` included: such a property may not hold its literal value.
  const writtenHere = new Set<string>();
  walkAll(ast.root, (node) => {
    if (node.type !== "AssignmentExpression") return;
    const left = role(node, "left");
    if ((left?.type === "MemberExpression" || left?.type === "OptionalMemberExpression") && left.attributes.computed !== true) {
      const name = nameOf(role(left, "property"));
      if (name !== undefined) writtenHere.add(name);
    }
  });

  const factories: FactoryFact[] = [];
  walkAll(ast.root, (node) => {
    if (node.type !== "FunctionDeclaration") return;
    const functionSymbol = (byStart.get(startKey(node.location) ?? "") ?? []).find((symbol) => symbol.kind === "function");
    const body = role(node, "body");
    if (functionSymbol === undefined || body === undefined) return;
    const returned = new Set<string>();
    let bareReturn = false;
    walkOwn(body, (inner) => {
      if (inner.type !== "ReturnStatement") return;
      const argument = role(inner, "argument");
      const name = argument?.type === "Identifier" ? nameOf(argument) : undefined;
      if (name === undefined) bareReturn = true;
      else returned.add(name);
    });
    if (bareReturn || returned.size !== 1) return;
    const objectName = [...returned][0]!;
    const declarators: ASTNode[] = [];
    walkOwn(body, (inner) => { if (inner.type === "VariableDeclarator" && nameOf(role(inner, "id")) === objectName) declarators.push(inner); });
    let reassigned = false;
    walkAll(body, (inner) => { if (inner.type === "AssignmentExpression" && nameOf(role(inner, "left")) === objectName) reassigned = true; });
    const literal = declarators.length === 1 ? role(declarators[0]!, "init") : undefined;
    const isFunction = literal?.type === "FunctionExpression" || literal?.type === "ArrowFunctionExpression";
    if (reassigned || (literal?.type !== "ObjectExpression" && !isFunction)) return;
    if (literal.children.some((child) => child.type === "SpreadElement")) return;
    const copies = isFunction || literal.type === "ObjectExpression" ? collectCopies(body, objectName, symbols, filePath) : [];
    if (copies === undefined) return;

    const seen = new Map<string, number>();
    const methods = new Map<string, string>();
    for (const property of isFunction ? [] : literal.children) {
      const name = keyName(property);
      if (name === undefined) continue;
      seen.set(name, (seen.get(name) ?? 0) + 1);
      let target: CodeSymbol | undefined;
      if (property.type === "ObjectMethod" && property.attributes.kind === "method") {
        target = (byStart.get(startKey(property.location) ?? "") ?? []).find((symbol) => symbol.name === name && (symbol.kind === "method" || symbol.kind === "function" || symbol.kind === "variable"));
      } else if (property.type === "ObjectProperty") {
        const value = role(property, "value");
        if (value?.type === "FunctionExpression" || value?.type === "ArrowFunctionExpression") {
          target = (byStart.get(startKey(property.location) ?? "") ?? []).find((symbol) => symbol.name === name && (symbol.kind === "variable" || symbol.kind === "method" || symbol.kind === "function"));
        } else if (value?.type === "Identifier") {
          const candidates = functionsByName.get(nameOf(value) ?? "") ?? [];
          target = candidates.length === 1 ? candidates[0] : undefined;
        }
      }
      if (target !== undefined) methods.set(name, target.id);
    }
    const kept = [...methods].filter(([name]) => seen.get(name) === 1 && !writtenHere.has(name)).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    if (kept.length === 0 && copies.length === 0) return;
    const ids = [functionSymbol.id, ...symbols.filter((symbol) => symbol.kind === "export" && symbol.moduleSpecifier === undefined && symbol.sourceSymbolName === functionSymbol.name).map((symbol) => symbol.id)];
    factories.push({
      ids: [...new Set(ids)].sort(),
      methods: kept,
      ...(copies.length === 0 ? {} : {
        copies,
        literalNames: [...seen.keys()].sort(),
        writtenHere: [...writtenHere].sort(),
        ...(isFunction ? { function: true as const } : {}),
      }),
    });
  });
  factories.push(...collectConstructors(ast, symbols, byStart));
  const { members: exportMembers, names: exportNames } = collectExportMembers(ast, symbols);
  // C3b: the file's one default export, when it is a factory, or a re-export of another file's default.
  const defaults = symbols.filter((symbol) => symbol.kind === "export" && symbol.defaultExport);
  let moduleExportsWrites = 0;
  walkAll(ast.root, (node) => { if (node.type === "AssignmentExpression" && isModuleExports(role(node, "left"))) moduleExportsWrites++; });
  const single = defaults.length === 1 && moduleExportsWrites === 1 ? defaults[0] : undefined;
  const defaultFactoryIds = single === undefined ? [] : factories.filter((factory) => factory.constructed !== true && factory.ids.includes(single.id)).flatMap((factory) => factory.ids);
  let reexportsDefault: { exportIds: string[]; specifier: string } | undefined;
  if (single !== undefined) {
    for (const statement of ast.root.children) {
      const expression = statement.type === "ExpressionStatement" ? role(statement, "expression") : undefined;
      const right = expression?.type === "AssignmentExpression" && isModuleExports(role(expression, "left")) ? role(expression, "right") : undefined;
      if (right?.type !== "CallExpression" || pathOf(role(right, "callee"))?.join(".") !== "require") continue;
      const argument = callArguments(right)[0];
      const specifier = argument?.type === "StringLiteral" && typeof argument.attributes.value === "string" ? argument.attributes.value : undefined;
      if (specifier !== undefined && /^\.\.?(\/|$)/.test(specifier) && !symbols.some((symbol) => symbol.name === "require" && symbol.kind !== "export")) {
        reexportsDefault = { exportIds: [single.id], specifier };
      }
    }
  }
  return {
    filePath,
    factories,
    ...(exportMembers.length === 0 ? {} : { exportMembers }),
    ...(exportNames === undefined ? {} : { exportNames }),
    ...(reexportsDefault === undefined ? {} : { reexportsDefault }),
    ...(defaultFactoryIds.length === 0 ? {} : { defaultFactoryIds }),
  };
}

/**
 * Phase C3b: the copies onto `objectName` that the factory body makes as its own top-level statements, in order. A copy
 * elsewhere in the body (inside a branch or a nested function) or from a source whose names are not known makes the
 * result unknown (`undefined`).
 */
function collectCopies(body: ASTNode, objectName: string, symbols: readonly CodeSymbol[], filePath: string): CopyFact[] | undefined {
  const isCopyCall = (call: ASTNode): "merge" | "assign" | undefined => {
    const callee = role(call, "callee");
    if (callee?.type === "Identifier") {
      const binding = moduleImport(nameOf(callee) ?? "", symbols);
      return binding?.moduleSpecifier === "merge-descriptors" && binding.sourceSymbolName === undefined ? "merge" : undefined;
    }
    return pathOf(callee)?.join(".") === "Object.assign" && !symbols.some((symbol) => symbol.name === "Object") ? "assign" : undefined;
  };
  const targetsObject = (call: ASTNode): boolean => {
    const first = callArguments(call)[0];
    return first?.type === "Identifier" && nameOf(first) === objectName;
  };
  const topLevel = new Set<ASTNode>();
  for (const statement of body.children) {
    const expression = statement.type === "ExpressionStatement" ? role(statement, "expression") : undefined;
    if (expression?.type === "CallExpression") topLevel.add(expression);
  }
  let stray = false;
  walkAll(body, (node) => { if (node.type === "CallExpression" && !topLevel.has(node) && isCopyCall(node) !== undefined && targetsObject(node)) stray = true; });
  if (stray) return undefined;

  const copies: CopyFact[] = [];
  for (const call of topLevel) {
    const kind = isCopyCall(call);
    if (kind === undefined || !targetsObject(call)) continue;
    const args = callArguments(call);
    const sources = kind === "merge" ? args.slice(1, 2) : args.slice(1);
    let overwrite = true;
    if (kind === "merge" && args.length === 3) {
      const flag = args[2]!;
      if (flag.type !== "BooleanLiteral" || typeof flag.attributes.value !== "boolean") return undefined;
      overwrite = flag.attributes.value;
    }
    if (kind === "merge" && (args.length < 2 || args.length > 3)) return undefined;
    for (const source of sources) {
      const fact = copySource(source, symbols, filePath, overwrite);
      if (fact === undefined) return undefined;
      copies.push(fact);
    }
  }
  return copies;
}

/** A copy source with known names: `require("./x")`'s exports, or `EventEmitter.prototype` from `events`. */
function copySource(source: ASTNode, symbols: readonly CodeSymbol[], filePath: string, overwrite: boolean): CopyFact | undefined {
  if (source.type === "Identifier") {
    const binding = moduleImport(nameOf(source) ?? "", symbols);
    const specifier = binding?.moduleSpecifier;
    if (specifier === undefined || !/^\.\.?\//.test(specifier) || binding!.sourceSymbolName !== undefined) return undefined;
    return { overwrite, module: { importer: filePath, specifier } };
  }
  const owner = prototypeOwner(source);
  const binding = owner === undefined ? undefined : moduleImport(owner, symbols);
  if (binding?.moduleSpecifier === "events" && (binding.sourceSymbolName === "EventEmitter" || binding.sourceSymbolName === undefined)) {
    return { overwrite, external: { module: "events", member: "EventEmitter.prototype" } };
  }
  return undefined;
}

function isModuleExports(node: ASTNode | undefined): boolean {
  return pathOf(node)?.join(".") === "module.exports";
}

/** The members of `module.exports = { … }`, or `undefined` when the literal could hide or replace one. */
function literalMembers(literal: ASTNode): Map<string, ASTNode> | undefined {
  const members = new Map<string, ASTNode>();
  const seen = new Map<string, number>();
  for (const property of literal.children) {
    // A spread may supply or replace any name.
    if (property.type !== "ObjectProperty" && property.type !== "ObjectMethod") return undefined;
    const name = keyName(property);
    if (name === undefined) {
      if (property.attributes.computed === true) return undefined;
      continue;
    }
    seen.set(name, (seen.get(name) ?? 0) + 1);
    if (property.type === "ObjectMethod" && property.attributes.kind !== "method") continue;
    members.set(name, property);
  }
  for (const [name, count] of seen) if (count > 1) members.delete(name);
  return members;
}

/**
 * Phase C3a: what a `require` of this file returns, by member name, when the file builds its exports object in one of
 * two plain ways, at the top of the file:
 * - `module.exports = { use: function …, init: init }`, the only write of `module.exports`, with no spread or computed
 *   key; a member is a function expression, a method, or a function declared at the top of the file and never
 *   reassigned;
 * - `var app = exports = module.exports = {}` (or `const app = module.exports` with no write of `module.exports`), `app`
 *   never reassigned, then `app.use = function …` statements.
 * A name written by name anywhere else in the file (on any object), or passed as a literal key to
 * `Object.defineProperty`, is left out; so is everything when the exports object or its alias is passed to a call. A
 * computed write (`app[method] = …`) is assumed not to produce the name, as for C1.
 */
function collectExportMembers(ast: ASTResult, symbols: readonly CodeSymbol[]): { readonly members: (readonly [string, string])[]; readonly names?: string[] } {
  if (symbols.some((symbol) => (symbol.name === "module" || symbol.name === "exports") && symbol.kind !== "export" && symbol.kind !== "import")) return { members: [] };
  let moduleExportsWrites = 0;
  const writes = new Map<string, number>();
  const reassigned = new Set<string>();
  const passed = new Set<string>();
  walkAll(ast.root, (node) => {
    if (node.type === "AssignmentExpression") {
      const left = role(node, "left");
      if (isModuleExports(left)) moduleExportsWrites++;
      if (left?.type === "Identifier" && nameOf(left) !== undefined) reassigned.add(nameOf(left)!);
      if ((left?.type === "MemberExpression" || left?.type === "OptionalMemberExpression") && left.attributes.computed !== true) {
        const name = nameOf(role(left, "property"));
        if (name !== undefined) writes.set(name, (writes.get(name) ?? 0) + 1);
      }
    }
    if (node.type === "CallExpression" || node.type === "NewExpression" || node.type === "OptionalCallExpression") {
      const literal = literalKeyWrite(node);
      if (literal !== undefined) writes.set(literal, (writes.get(literal) ?? 0) + 1);
      for (const argument of callArguments(node)) {
        if (isModuleExports(argument)) passed.add("module.exports");
        else if (argument.type === "Identifier" && nameOf(argument) !== undefined) passed.add(nameOf(argument)!);
      }
    }
  });
  if (passed.has("module.exports") || passed.has("exports")) return { members: [] };
  // C3b: every name the exports object may hold. A superset is safe: a copy that seems to bring a name it does not
  // only leaves calls unresolved; a missing name could not be.
  let names: Set<string> | undefined;

  const topFunctions = new Map<string, CodeSymbol>();
  for (const symbol of symbols) if (symbol.kind === "function" && symbol.scopeId === "scope:module" && !reassigned.has(symbol.name)) topFunctions.set(symbol.name, symbol);
  const isFunctionValue = (value: ASTNode | undefined): boolean =>
    value?.type === "FunctionExpression" || value?.type === "ArrowFunctionExpression" || (value?.type === "Identifier" && topFunctions.has(nameOf(value) ?? ""));
  const result: [string, string][] = [];

  for (const statement of ast.root.children) {
    // Form 1: `module.exports = { … }`.
    const expression = statement.type === "ExpressionStatement" ? role(statement, "expression") : undefined;
    if (expression?.type === "AssignmentExpression" && expression.attributes.operator === "=" && isModuleExports(role(expression, "left"))
      && role(expression, "right")?.type === "ObjectExpression" && moduleExportsWrites === 1) {
      const complete = literalMembers(role(expression, "right")!);
      if (complete !== undefined) {
        names = new Set(writes.keys());
        for (const property of role(expression, "right")!.children) { const key = keyName(property); if (key !== undefined) names.add(key); }
      }
      const members = complete ?? new Map<string, ASTNode>();
      for (const [name, property] of members) {
        if ((writes.get(name) ?? 0) > 0) continue;
        const value = property.type === "ObjectMethod" ? property : role(property, "value") ?? (property.attributes.shorthand === true ? role(property, "key") : undefined);
        if (property.type !== "ObjectMethod" && !isFunctionValue(value)) continue;
        const exported = symbols.filter((symbol) => symbol.kind === "export" && !symbol.defaultExport && symbol.name === name && startKey(symbol.location) === startKey(property.location));
        if (exported.length === 1) result.push([name, exported[0]!.id]);
      }
    }
  }

  // Form 2: an alias of the exports object, filled by top-level statements.
  for (const statement of ast.root.children) {
    if (statement.type !== "VariableDeclaration") continue;
    const declarators = statement.children.filter((child) => child.type === "VariableDeclarator");
    if (declarators.length !== 1) continue;
    const alias = nameOf(role(declarators[0]!, "id"));
    let init = role(declarators[0]!, "init");
    if (alias === undefined || init === undefined || reassigned.has(alias) || passed.has(alias)) continue;
    let viaWrite = false;
    // `exports = module.exports = {}`: walk the assignment chain to its innermost value.
    while (init?.type === "AssignmentExpression" && init.attributes.operator === "=") {
      const left = role(init, "left");
      if (isModuleExports(left)) viaWrite = true;
      else if (!(left?.type === "Identifier" && nameOf(left) === "exports")) { init = undefined; break; }
      init = role(init, "right");
    }
    const fresh = viaWrite && moduleExportsWrites === 1 && init?.type === "ObjectExpression" && init.children.length === 0;
    const direct = !viaWrite && isModuleExports(init) && moduleExportsWrites === 0;
    if (!fresh && !direct) continue;
    names = new Set(writes.keys());
    for (const inner of ast.root.children) {
      const write = inner.type === "ExpressionStatement" ? role(inner, "expression") : undefined;
      const left = write?.type === "AssignmentExpression" && write.attributes.operator === "=" ? role(write, "left") : undefined;
      if (left?.type !== "MemberExpression" || left.attributes.computed === true || nameOf(role(left, "object")) !== alias) continue;
      const name = nameOf(role(left, "property"));
      if (name === undefined || writes.get(name) !== 1 || !isFunctionValue(role(write!, "right"))) continue;
      const method = symbols.filter((symbol) => symbol.name === name && symbol.containerName === alias && (symbol.kind === "method" || symbol.kind === "variable") && symbol.scopeId === "scope:module");
      if (method.length === 1) result.push([name, method[0]!.id]);
    }
  }
  return {
    members: result.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
    ...(names === undefined ? {} : { names: [...names].sort() }),
  };
}

/** `F.prototype` for a plain identifier `F`, or undefined. */
function prototypeOwner(node: ASTNode | undefined): string | undefined {
  if (node?.type !== "MemberExpression" || node.attributes.computed === true) return undefined;
  const object = role(node, "object");
  return nameOf(role(node, "property")) === "prototype" && object?.type === "Identifier" ? nameOf(object) : undefined;
}

/**
 * Phase C2: constructor functions declared in the file and the methods their prototype is given by name,
 * `F.prototype.m = function …` (or a function's name). A fresh `F.prototype` holds only `constructor`, so a call on an
 * instance before the assignment runs throws rather than reaching another function; this is why `F` is never passed to a
 * call and its prototype never replaced, except through one recognised parent link (C2b, parentLink), where a top-level
 * call before the methods are assigned stays unresolved instead. A method name written by name anywhere else in the
 * file, on any object, is left out, as for C1.
 */
function collectConstructors(ast: ASTResult, symbols: readonly CodeSymbol[], byStart: ReadonlyMap<string, CodeSymbol[]>): FactoryFact[] {
  const writes = new Map<string, number>();
  const prototypeWrites = new Map<string, [string, ASTNode][]>();
  const disqualified = new Set<string>();
  // Only a top-level statement's `F` is surely the file's own `F`; one in a function may be a parameter or a local of
  // that name, so a prototype write there disqualifies the name.
  const topLevel = new Set<ASTNode>();
  // Phase C2b: top-level statements that link `F` to a parent, or define a literal-named prototype property; their
  // arguments do not disqualify `F`. Statement positions order the links before the methods.
  const handled = new Set<ASTNode>();
  const links = new Map<string, { readonly parent: string; readonly at: number }[]>();
  const firstMethodAt = new Map<string, number>();
  const lastMethodEnd = new Map<string, { readonly line: number; readonly column: number }>();
  // `Object.create` and friends are the standard ones only where the file binds no `Object` of its own.
  const standardObject = !symbols.some((symbol) => symbol.name === "Object");
  ast.root.children.forEach((statement, position) => {
    const expression = statement.type === "ExpressionStatement" ? role(statement, "expression") : undefined;
    if (expression === undefined) return;
    if (expression.type === "AssignmentExpression") {
      topLevel.add(expression);
      const left = role(expression, "left");
      const owner = left?.type === "MemberExpression" && left.attributes.computed !== true ? prototypeOwner(role(left, "object")) : undefined;
      if (owner !== undefined) {
        if (!firstMethodAt.has(owner)) firstMethodAt.set(owner, position);
        if (expression.location !== undefined) lastMethodEnd.set(owner, expression.location.end);
      }
    }
    const link = parentLink(expression, symbols, standardObject);
    if (link !== undefined) {
      handled.add(expression);
      // The `Object.create(X.prototype)` on the right reads X's prototype; it does not change it.
      if (expression.type === "AssignmentExpression") handled.add(role(expression, "right")!);
      links.set(link.child, [...(links.get(link.child) ?? []), { parent: link.parent, at: position }]);
    }
    if (standardObject && literalDefinition(expression) !== undefined) handled.add(expression);
  });
  walkAll(ast.root, (node) => {
    // A literal-key `Object.defineProperty(o, "m", …)` anywhere in the file writes `m`.
    const defined = node.type === "CallExpression" ? literalKeyWrite(node) : undefined;
    if (defined !== undefined) writes.set(defined, (writes.get(defined) ?? 0) + 1);
    if (node.type === "AssignmentExpression") {
      const left = role(node, "left");
      if ((left?.type === "MemberExpression" || left?.type === "OptionalMemberExpression") && left.attributes.computed !== true) {
        const name = nameOf(role(left, "property"));
        if (name !== undefined) writes.set(name, (writes.get(name) ?? 0) + 1);
        const owner = prototypeOwner(role(left, "object"));
        if (owner !== undefined && name !== undefined && node.attributes.operator === "=" && topLevel.has(node)) {
          prototypeWrites.set(owner, [...(prototypeWrites.get(owner) ?? []), [name, role(node, "right")!]]);
        } else if (owner !== undefined) disqualified.add(owner);
      }
      // `F.prototype[key] = …` may write any name.
      if ((left?.type === "MemberExpression" || left?.type === "OptionalMemberExpression") && left.attributes.computed === true) {
        const owner = prototypeOwner(role(left, "object"));
        if (owner !== undefined) disqualified.add(owner);
      }
      // `F.prototype = …` replaces the prototype; `F = …` rebinds the constructor.
      const replaced = prototypeOwner(left);
      if (replaced !== undefined && !handled.has(node)) disqualified.add(replaced);
      if (left?.type === "Identifier" && nameOf(left) !== undefined) disqualified.add(nameOf(left)!);
    }
    if ((node.type === "CallExpression" || node.type === "NewExpression" || node.type === "OptionalCallExpression") && !handled.has(node)) {
      for (const argument of node.children.filter((child) => child.role === "arguments")) {
        if (argument.type === "Identifier" && nameOf(argument) !== undefined) disqualified.add(nameOf(argument)!);
        const owner = prototypeOwner(argument);
        if (owner !== undefined) disqualified.add(owner);
      }
    }
  });

  const found: FactoryFact[] = [];
  for (const node of ast.root.children) {
    if (node.type !== "FunctionDeclaration") continue;
    const functionSymbol = (byStart.get(startKey(node.location) ?? "") ?? []).find((symbol) => symbol.kind === "function");
    const body = role(node, "body");
    if (functionSymbol === undefined || body === undefined || disqualified.has(functionSymbol.name)) continue;
    // C2b: at most one parent link, before every method, to a parent whose constructor cannot give the instance an own
    // method this file does not see (a package, a standard error, or a constructor declared here).
    const linked = links.get(functionSymbol.name) ?? [];
    if (linked.length > 1) continue;
    const link = linked[0];
    if (link !== undefined && (link.at > (firstMethodAt.get(functionSymbol.name) ?? Number.POSITIVE_INFINITY) || !knownParent(link.parent, symbols, disqualified))) continue;
    // `new F()` yields `this`, unless the body returns another object. `return this` and the ES5 guard
    // `if (!(this instanceof F)) return new F(…)` both yield an F.
    let returnsValue = false;
    walkOwn(body, (inner) => {
      if (inner.type !== "ReturnStatement") return;
      const argument = role(inner, "argument");
      const callee = argument?.type === "NewExpression" ? role(argument, "callee") : undefined;
      const selfConstructed = callee?.type === "Identifier" && nameOf(callee) === functionSymbol.name;
      if (argument !== undefined && argument.type !== "ThisExpression" && !selfConstructed) returnsValue = true;
    });
    if (returnsValue) continue;
    const methods: [string, string][] = [];
    for (const [name, value] of prototypeWrites.get(functionSymbol.name) ?? []) {
      if (writes.get(name) !== 1 || name === "constructor" || name === "__proto__") continue;
      const isFunction = value.type === "FunctionExpression" || value.type === "ArrowFunctionExpression"
        || (value.type === "Identifier" && symbols.some((symbol) => symbol.kind === "function" && symbol.name === nameOf(value)));
      if (!isFunction) continue;
      const candidates = symbols.filter((symbol) => symbol.name === name && symbol.containerName === `${functionSymbol.name}.prototype` && symbol.kind === "method");
      if (candidates.length === 1) methods.push([name, candidates[0]!.id]);
    }
    if (methods.length === 0) continue;
    methods.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    const ids = [functionSymbol.id, ...symbols.filter((symbol) => symbol.kind === "export" && symbol.moduleSpecifier === undefined && symbol.sourceSymbolName === functionSymbol.name).map((symbol) => symbol.id)];
    const readyAt = link === undefined ? undefined : lastMethodEnd.get(functionSymbol.name);
    found.push({ ids: [...new Set(ids)].sort(), methods, constructed: true, ...(readyAt === undefined ? {} : { readyAt }) });
  }
  return found;
}

/** A member path rooted at an identifier (`util.inherits`), or undefined. */
function pathOf(node: ASTNode | undefined): string[] | undefined {
  if (node?.type === "Identifier") { const name = nameOf(node); return name === undefined ? undefined : [name]; }
  if (node?.type !== "MemberExpression" || node.attributes.computed === true) return undefined;
  const base = pathOf(role(node, "object"));
  const property = nameOf(role(node, "property"));
  return base === undefined || property === undefined ? undefined : [...base, property];
}

function callArguments(node: ASTNode): ASTNode[] {
  return node.children.filter((child) => child.role === "arguments");
}

/** The module-scope import binding `name`, when the file has exactly one declaration of that name. */
function moduleImport(name: string, symbols: readonly CodeSymbol[]): CodeSymbol | undefined {
  const declared = symbols.filter((symbol) => symbol.name === name && symbol.scopeId === "scope:module" && symbol.kind !== "export");
  const imports = declared.filter((symbol) => symbol.kind === "import");
  // A CommonJS `const X = require(…)` is an import and a variable of the same name.
  return imports.length === 1 && declared.every((symbol) => symbol.kind === "import" || symbol.kind === "variable") ? imports[0] : undefined;
}

/**
 * Phase C2b: `F.prototype = Object.create(X.prototype)`, `Object.setPrototypeOf(F.prototype, X.prototype)` or
 * `inherits(F, X)` from `util` or the `inherits` package.
 */
function parentLink(expression: ASTNode, symbols: readonly CodeSymbol[], standardObject: boolean): { readonly child: string; readonly parent: string } | undefined {
  if (expression.type === "AssignmentExpression" && expression.attributes.operator === "=") {
    if (!standardObject) return undefined;
    const child = prototypeOwner(role(expression, "left"));
    const right = role(expression, "right");
    if (child === undefined || right?.type !== "CallExpression" || pathOf(role(right, "callee"))?.join(".") !== "Object.create") return undefined;
    const args = callArguments(right);
    const parent = args.length === 1 ? prototypeOwner(args[0]) : undefined;
    return parent === undefined ? undefined : { child, parent };
  }
  if (expression.type !== "CallExpression") return undefined;
  const callee = pathOf(role(expression, "callee"));
  const args = callArguments(expression);
  if (args.length !== 2 || callee === undefined) return undefined;
  if (callee.join(".") === "Object.setPrototypeOf") {
    if (!standardObject) return undefined;
    const child = prototypeOwner(args[0]);
    const parent = prototypeOwner(args[1]);
    return child === undefined || parent === undefined ? undefined : { child, parent };
  }
  const binding = moduleImport(callee[0]!, symbols);
  const fromUtil = callee.length === 2 && callee[1] === "inherits" && binding?.moduleSpecifier === "util" && binding.sourceSymbolName === undefined;
  const direct = callee.length === 1 && (binding?.moduleSpecifier === "inherits" || (binding?.moduleSpecifier === "util" && binding.sourceSymbolName === "inherits"));
  if (!fromUtil && !direct) return undefined;
  const child = args[0]!.type === "Identifier" ? nameOf(args[0]) : undefined;
  const parent = args[1]!.type === "Identifier" ? nameOf(args[1]) : undefined;
  return child === undefined || parent === undefined ? undefined : { child, parent };
}

/**
 * `Object.defineProperty(F.prototype, "name", …)` or `Object.defineProperty(F, "name", …)`: a write of that one name
 * (a static property of F leaves its instances alone, unless the name is `prototype`).
 */
function literalDefinition(expression: ASTNode): { readonly name: string } | undefined {
  if (expression.type !== "CallExpression" || pathOf(role(expression, "callee"))?.join(".") !== "Object.defineProperty") return undefined;
  const args = callArguments(expression);
  const key = args[1];
  const target = args[0];
  if (args.length !== 3 || key?.type !== "StringLiteral" || typeof key.attributes.value !== "string") return undefined;
  if (prototypeOwner(target) === undefined && !(target?.type === "Identifier" && key.attributes.value !== "prototype")) return undefined;
  return { name: key.attributes.value };
}

/** The name an `Object.defineProperty(o, "m", …)` call writes, whatever `o` is. */
function literalKeyWrite(call: ASTNode): string | undefined {
  const path = pathOf(role(call, "callee"))?.join(".");
  if (path !== "Object.defineProperty" && path !== "Reflect.defineProperty") return undefined;
  const key = callArguments(call)[1];
  return key?.type === "StringLiteral" && typeof key.attributes.value === "string" ? key.attributes.value : undefined;
}

const STANDARD_ERRORS = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "EvalError", "URIError"]);

/**
 * A parent whose constructor gives instances no own method the analysis misses: a package or Node module import
 * (assumed to set only data fields), a standard error (no binding of that name in the file), or a constructor declared
 * at the top of this file (its `this.m = …` writes count as this file's writes of `m`).
 */
function knownParent(parent: string, symbols: readonly CodeSymbol[], disqualified: ReadonlySet<string>): boolean {
  if (disqualified.has(parent)) return false;
  const declared = symbols.filter((symbol) => symbol.name === parent && symbol.kind !== "export");
  if (declared.length === 0) return STANDARD_ERRORS.has(parent);
  const imported = moduleImport(parent, symbols);
  if (imported !== undefined) return imported.moduleSpecifier !== undefined && !/^[./]/.test(imported.moduleSpecifier);
  return declared.length === 1 && declared[0]!.kind === "function" && declared[0]!.scopeId === "scope:module";
}

interface FactoryEntry {
  readonly filePath: string;
  readonly methods: ReadonlyMap<string, string>;
  readonly readyAt?: { readonly line: number; readonly column: number };
  readonly copies?: readonly CopyFact[];
  readonly literalNames?: ReadonlySet<string>;
  readonly function?: true;
  readonly writtenHere?: ReadonlySet<string>;
}

/** Where a factory's object gets a name from, once its copies are replayed (C3b). */
type Provider =
  | { readonly kind: "own" }
  | { readonly kind: "module"; readonly filePath: string }
  | { readonly kind: "external"; readonly module: string; readonly member: string }
  | { readonly kind: "unknown" };

/** The run's factories, looked up by the symbol a factory call resolves to, and plainly built exports objects. */
export class FactoryIndex {
  private readonly methodsById = new Map<string, FactoryEntry>();
  private readonly prototypeById = new Map<string, FactoryEntry>();
  private readonly exportMembersByFile = new Map<string, ReadonlyMap<string, string>>();
  private readonly exportNamesByFile = new Map<string, ReadonlySet<string>>();

  /**
   * @param writtenElsewhere - whether a file other than `filePath` writes a property of that name on an object other
   *   than `this` and its own exports. The factory's own file was checked when its facts were collected.
   * @param resolveModule - the file a module specifier names from an importing file (C3b copies), when known.
   */
  public constructor(
    files: Iterable<FactoryFile>,
    private readonly writtenElsewhere: (name: string, filePath: string) => boolean,
    private readonly resolveModule: (importer: string, specifier: string) => string | undefined = () => undefined,
  ) {
    for (const file of files) {
      if (file.exportMembers !== undefined) this.exportMembersByFile.set(file.filePath, new Map(file.exportMembers));
      if (file.exportNames !== undefined) this.exportNamesByFile.set(file.filePath, new Set(file.exportNames));
      for (const factory of file.factories) {
        const entry: FactoryEntry = {
          filePath: file.filePath,
          methods: new Map(factory.methods),
          ...(factory.readyAt === undefined ? {} : { readyAt: factory.readyAt }),
          ...(factory.copies === undefined ? {} : {
            copies: factory.copies,
            literalNames: new Set(factory.literalNames ?? []),
            writtenHere: new Set(factory.writtenHere ?? []),
            ...(factory.function === true ? { function: true as const } : {}),
          }),
        };
        for (const id of factory.ids) (factory.constructed === true ? this.prototypeById : this.methodsById).set(id, entry);
      }
      const defaultEntry = file.defaultFactoryIds?.[0] === undefined ? undefined : this.methodsById.get(file.defaultFactoryIds[0]);
      if (defaultEntry !== undefined) this.methodsById.set(`default:${file.filePath}`, defaultEntry);
      for (const id of file.reexportsDefault?.exportIds ?? []) this.reexports.set(id, { importer: file.filePath, specifier: file.reexportsDefault!.specifier });
    }
  }

  private readonly reexports = new Map<string, { readonly importer: string; readonly specifier: string }>();

  /** A factory by the symbol its call resolved to, through `module.exports = require("./x")` re-exports (C3b). */
  private factoryEntry(producerId: string): FactoryEntry | undefined {
    let id = producerId;
    for (let hop = 0; hop < 8; hop++) {
      const entry = this.methodsById.get(id);
      if (entry !== undefined) return entry;
      const link = this.reexports.get(id);
      const target = link === undefined ? undefined : this.resolveModule(link.importer, link.specifier);
      if (target === undefined) return undefined;
      id = `default:${target}`;
    }
    return undefined;
  }

  /** C3a: the function `require(filePath).name` reaches, when that file builds its exports object plainly. */
  public exportMemberOf(filePath: string, name: string): string | undefined {
    const target = this.exportMembersByFile.get(filePath)?.get(name);
    return target === undefined || this.writtenElsewhere(name, filePath) ? undefined : target;
  }

  /**
   * C3b: replays a factory's copies in order. The object starts with its own literal keys (or a function's own
   * properties); a copy takes a name its source holds when it overwrites, or when the object has no such name yet.
   */
  private provider(entry: FactoryEntry, name: string): Provider | undefined {
    if (entry.writtenHere?.has(name) === true) return { kind: "unknown" };
    let current: Provider | undefined = entry.literalNames?.has(name) === true || (entry.function === true && FUNCTION_OWN.has(name)) ? { kind: "own" } : undefined;
    for (const copy of entry.copies ?? []) {
      let source: Provider;
      let names: ReadonlySet<string> | undefined;
      if (copy.module !== undefined) {
        const filePath = this.resolveModule(copy.module.importer, copy.module.specifier);
        names = filePath === undefined ? undefined : this.exportNamesByFile.get(filePath);
        source = { kind: "module", filePath: filePath ?? "" };
      } else {
        const key = `${copy.external!.module}:${copy.external!.member}`;
        names = KNOWN_PROTOTYPES[key];
        source = { kind: "external", module: copy.external!.module, member: copy.external!.member };
      }
      if (names === undefined) return { kind: "unknown" };
      if (names.has(name) && (copy.overwrite || current === undefined)) current = source;
    }
    return current;
  }

  /** C3b: the built-in a factory's object holds at `name`, copied from a known prototype such as `EventEmitter`'s. */
  public externalOf(producerId: string, name: string): { readonly module: string; readonly member: string } | undefined {
    const entry = this.factoryEntry(producerId);
    if (entry?.copies === undefined) return undefined;
    const provider = this.provider(entry, name);
    if (provider?.kind !== "external" || this.writtenElsewhere(name, entry.filePath)) return undefined;
    return { module: provider.module, member: `${provider.member}.${name}` };
  }

  /**
   * The function the object made by a call resolved to `producerId` holds at `name`: a factory's returned literal for
   * `F()` (C1) or what its copies bring (C3b), a constructor's prototype for `new F()` (C2).
   */
  public methodOf(producerId: string, name: string, constructed = false, topLevelCall?: { readonly filePath: string; readonly line: number; readonly column: number }): string | undefined {
    const entry = constructed ? this.prototypeById.get(producerId) : this.factoryEntry(producerId);
    if (entry?.copies !== undefined) {
      const provider = this.provider(entry, name);
      if (provider?.kind === "module") return this.exportMemberOf(provider.filePath, name);
      if (provider?.kind !== "own") return undefined;
    }
    const target = entry?.methods.get(name);
    if (target === undefined || this.writtenElsewhere(name, entry!.filePath)) return undefined;
    // C2b: a top-level call of the constructor's own file that starts before its methods are all assigned.
    const ready = entry!.readyAt;
    if (ready !== undefined && topLevelCall !== undefined && topLevelCall.filePath === entry!.filePath
      && (topLevelCall.line < ready.line || (topLevelCall.line === ready.line && topLevelCall.column < ready.column))) return undefined;
    return target;
  }
}
