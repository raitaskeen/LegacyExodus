/**
 * Write facts collected from every file of a run before calls resolve: unstable exports, writes on other modules'
 * exports, standard-global writes and package writes.
 */
import type { ASTNode, ASTResult } from "@parser/index";
import { canonicalizePath } from "@graph/index";
import type { SymbolTable } from "@symbols/index";
import { type CodeSymbol } from "@symbols/index";
import { writtenTargets } from "./class-hierarchy";
import { compareCodePoints } from "@shared/ordering";
import { MODULE_SCOPE_ID, STANDARD_GLOBALS, bindingWriteKey, declarationAnchor, extractBoundNames, identifier, isRelativeSpecifier, lexicalBindingKey, memberPathOf, nodeName, packageName, propertyKeyName, staticPropertyKey } from "./scope-model";
import { collectBindingWrites } from "./binding-writes";

const directEvalByRoot = new WeakMap<ASTNode, boolean>();

/** Whether the file has a direct `eval(…)` call; computed once per AST (NA-02). */
export function callsEvalDirectly(root: ASTNode): boolean {
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

/**
 * byScopeAndName restricted to symbols that declare a binding: imports, classes, enums, namespaces,
 * functions and declared variables (declarators, parameters, catch parameters). Interfaces and type
 * aliases are type-only and declare none; they may share a name with a value. The extractor records
 * more under the same scope and name: members (methods, class properties, `o.p = …`, object
 * literal keys), export records, and `f = () => …` as a function named f, which writes f's
 * real declaration. Binding lookups that decide what a write or call refers to must skip
 * them, or a member named like a binding would stand in for that binding's declaration.
 */
export function bindingDeclarations(byScopeAndName: ReadonlyMap<string, readonly CodeSymbol[]>, root: ASTNode): ReadonlyMap<string, readonly CodeSymbol[]> {
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
  const { reboundBindings, blockFunctionVars } = collectBindingWrites(ast.root, bindingDeclarations(byScopeAndName, ast.root));
  // RT-L8: a sloppy block function of the same name (`if (…) { function run() {…} }`) replaces the binding when its block
  // runs (Annex B), so the export may hold that function instead.
  const rebound = (name: string | undefined): boolean => name !== undefined
    && (reboundBindings.has(bindingWriteKey(MODULE_SCOPE_ID, name)) || blockFunctionVars.has(bindingWriteKey(MODULE_SCOPE_ID, name)));
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

/**
 * A property written on another module's value, as one file sees it (OR-01). `*` is a computed name. `member` is the
 * whole written path when it is known to be deeper (`ObjectId.prototype._id`), ending at a computed member (XB-03).
 * `reexport` marks no write but a module value the exports object of `importerPath` may hold (RT-L7): `specifier` at
 * path `member`, `*` for a value whose origin is not known (see exportsValueRoots).
 */
export interface ForeignExportWrite { readonly importerPath: string; readonly specifier: string; readonly name: string; readonly member?: string; readonly reexport?: true }

/**
 * Writes this file makes to another module's exports: `require("./x").name = …`, or `x.name = …` where `x` is an
 * import holding a whole module (`const x = require("./x")`, a default import). Found by the oracle on Fastify: a test
 * replaced `require('../../lib/hooks').onSendHookRunner` and the engine still resolved calls to the original.
 * A name bound to such an import anywhere in the file counts, which only over-approximates.
 */
export function collectForeignExportWrites(ast: ASTResult, table: SymbolTable | undefined): readonly ForeignExportWrite[] {
  const importerPath = canonicalizePath(ast.metadata.sourcePath);
  const moduleImports = new Map<string, string>();
  for (const symbol of table?.symbols ?? []) {
    if (symbol.kind === "import" && symbol.defaultExport && typeof symbol.moduleSpecifier === "string") moduleImports.set(symbol.name, symbol.moduleSpecifier);
  }
  const writes: ForeignExportWrite[] = [];
  const visit = (node: ASTNode): void => {
    // Every write form counts: `[x.name] = …`, `for (x.name of …)`, `x.name++`, `(x.name as T) = …` (RT-M1).
    for (const left of writtenTargets(node)) {
      if (left.type !== "MemberExpression" && left.type !== "OptionalMemberExpression") continue;
      const object = left.children.find((child) => child.role === "object");
      const property = left.children.find((child) => child.role === "property");
      const name = left.attributes.computed === true
        ? (property?.type === "StringLiteral" && typeof property.attributes.value === "string" ? property.attributes.value : "*")
        : identifier(property) ?? "*";
      const specifier = object?.type === "CallExpression" ? requiredSpecifier(object)
        : object?.type === "Identifier" ? moduleImports.get(identifier(object) ?? "") : undefined;
      if (specifier !== undefined) writes.push({ importerPath, specifier, name });
    }
    for (const child of node.children) visit(child);
  };
  visit(ast.root);
  // XB-03: a package written through an alias or by reflection (`const p = path; p.join = …`). A specifier naming a
  // file keeps the direct writes above only.
  const packageImports = new Map<string, ValueRoot>();
  for (const symbol of table?.symbols ?? []) {
    if (symbol.kind !== "import" || typeof symbol.moduleSpecifier !== "string" || isRelativeSpecifier(symbol.moduleSpecifier)) continue;
    const whole = symbol.defaultExport || symbol.sourceSymbolName === "*";
    packageImports.set(symbol.name, { specifier: symbol.moduleSpecifier, path: whole ? [] : [symbol.sourceSymbolName ?? symbol.name] });
  }
  for (const write of aliasedWrites(ast.root, packageImports)) {
    if (write.specifier !== undefined && !isRelativeSpecifier(write.specifier) && write.path.length > 0) writes.push({ importerPath, specifier: write.specifier, name: write.path[0]!, member: write.path.join(".") });
  }
  // RT-L7: the module values this file's own exports object may hold, so that a write on it elsewhere reaches them.
  const importRoots = new Map<string, ValueRoot>();
  for (const symbol of table?.symbols ?? []) {
    if (symbol.kind !== "import" || typeof symbol.moduleSpecifier !== "string") continue;
    const whole = symbol.defaultExport || symbol.sourceSymbolName === "*";
    importRoots.set(symbol.name, { specifier: symbol.moduleSpecifier, path: whole ? [] : [symbol.sourceSymbolName ?? symbol.name] });
  }
  for (const root of exportsValueRoots(ast.root, importRoots)) {
    if (root.specifier !== undefined) writes.push({ importerPath, specifier: root.specifier, name: "", member: root.path.join("."), reexport: true });
  }
  return writes;
}

/**
 * RT-L7: where a file's exports object may come from when the file does not make it. `module.exports = require("fs")`
 * (also through `exports = module.exports = …`, `export default …` or `export = …`) gives `fs`;
 * `module.exports = require("fs").promises` gives `fs` at `promises`; an import binding gives its module and path. A
 * value made here (an object, array, function or class literal, `Object.create(…)`, or a name the file declares once and
 * never reassigns, as a function, a class or with such a value) gives nothing. So does any other value (a call's
 * result, `new`, a parameter, an alias): it is assumed to hold no package or global value, as XB-03 assumes for a
 * target reached any other way. Treating it as possibly any module's value blocked every package and global member of
 * the written name: one test stub `settingsCache.get = …` cost Ghost 50 correct `Map.prototype.get`/`http.get` calls.
 */
function exportsValueRoots(root: ASTNode, imports: ReadonlyMap<string, ValueRoot>): ValueRoot[] {
  // Names the file declares anywhere: such a name is not taken for the standard global of that name.
  const declarations = new Set<string>();
  const values: Array<ASTNode | undefined> = [];
  const walk = (node: ASTNode): void => {
    if (node.type === "VariableDeclarator") for (const name of extractBoundNames(node.children.find((child) => child.role === "id"))) declarations.add(name);
    if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") {
      const name = nodeName(node);
      if (name !== undefined) declarations.add(name);
    }
    if (node.type === "AssignmentExpression" && memberPathOf(node.children.find((child) => child.role === "left"))?.join(".") === "module.exports") {
      values.push(node.attributes.operator === "=" ? node.children.find((child) => child.role === "right") : undefined);
    }
    if (node.type === "ExportDefaultDeclaration") {
      const declaration = node.children.find((child) => child.role === "declaration");
      if (declaration !== undefined && declaration.type !== "FunctionDeclaration" && declaration.type !== "ClassDeclaration") values.push(declaration);
    }
    if (node.type === "TSExportAssignment") values.push(node.children.find((child) => child.role === "expression"));
    for (const child of node.children) walk(child);
  };
  walk(root);
  // `undefined`: made here, or not followed (see above).
  const rootOf = (value: ASTNode | undefined): ValueRoot | undefined => {
    if (value === undefined) return undefined;
    if (value.type === "AssignmentExpression" && value.attributes.operator === "=") return rootOf(value.children.find((child) => child.role === "right"));
    if (value.type === "CallExpression") {
      const specifier = requiredSpecifier(value);
      return specifier === undefined ? undefined : { specifier, path: [] };
    }
    if (value.type === "Identifier") {
      const name = identifier(value);
      const imported = name === undefined ? undefined : imports.get(name);
      if (imported !== undefined) return imported;
      // An unbound standard global (`module.exports = JSON`, `= process`, `= globalThis`) is the global value itself.
      if (name !== undefined && !declarations.has(name) && GLOBAL_OBJECTS.has(name)) return { specifier: GLOBAL_VALUE, path: [] };
      if (name !== undefined && !declarations.has(name) && STANDARD_GLOBALS.has(name)) return { specifier: GLOBAL_VALUE, path: [name] };
      return undefined;
    }
    if (value.type === "MemberExpression") {
      const property = value.children.find((child) => child.role === "property");
      const key = value.attributes.computed === true ? staticPropertyKey(property) : identifier(property);
      const base = rootOf(value.children.find((child) => child.role === "object"));
      return base === undefined || key === undefined ? undefined : { specifier: base.specifier, path: [...base.path, key] };
    }
    return undefined;
  };
  return values.flatMap((value) => {
    const found = rootOf(value);
    return found === undefined ? [] : [found];
  });
}

/** `require("literal")` and its specifier. */
function requiredSpecifier(call: ASTNode): string | undefined {
  const callee = call.children.find((child) => child.role === "callee");
  const args = call.children.filter((child) => child.role === "arguments");
  if (callee?.type !== "Identifier" || identifier(callee) !== "require" || args.length !== 1) return undefined;
  const value = args[0]?.type === "StringLiteral" ? args[0].attributes.value : undefined;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * The export symbols those writes may replace: in the file each specifier resolves to, the exports and exported
 * declarations of that name (all of them for a computed name). A specifier that resolves to no analysed file names
 * a package, which no call in the repository resolves into anyway.
 */
export function foreignExportWriteTargets(
  writes: readonly ForeignExportWrite[],
  resolveFile: (importerPath: string, specifier: string) => string | undefined,
  symbolsOf: (path: string) => readonly CodeSymbol[],
): readonly string[] {
  const ids = new Set<string>();
  for (const write of writes) {
    if (write.reexport === true) continue;
    const target = resolveFile(write.importerPath, write.specifier);
    if (target === undefined) continue;
    for (const symbol of symbolsOf(canonicalizePath(target))) {
      const exported = (symbol.kind === "export" && symbol.moduleSpecifier === undefined) || (symbol.exported && symbol.kind !== "import");
      if (exported && (write.name === "*" || symbol.name === write.name)) ids.add(symbol.id);
    }
  }
  return [...ids].sort(compareCodePoints);
}

/** Names through which code reaches the global object itself. */
const GLOBAL_OBJECTS: ReadonlySet<string> = new Set(["globalThis", "global", "window", "self"]);

/**
 * The standard-global paths one file writes: `console.log = …` gives `console.log`, `globalThis.JSON = …` and
 * `JSON = …` give `JSON`, a computed member `console[k] = …` gives `console.*`. Any binding of the name counts,
 * which only over-approximates: a write recorded wrongly can only keep a call UNRESOLVED.
 */
export function collectGlobalWrites(ast: ASTResult): readonly string[] {
  const paths = new Set<string>();
  const pathOf = (node: ASTNode | undefined): string[] | undefined => {
    if (node === undefined) return undefined;
    if (node.type === "Identifier") { const name = identifier(node); return name === undefined ? undefined : [name]; }
    if (node.type !== "MemberExpression" && node.type !== "OptionalMemberExpression") return undefined;
    const base = pathOf(node.children.find((child) => child.role === "object"));
    if (base === undefined) return undefined;
    const property = node.children.find((child) => child.role === "property");
    const name = node.attributes.computed === true
      ? (property?.type === "StringLiteral" && typeof property.attributes.value === "string" ? property.attributes.value : "*")
      : identifier(property) ?? "*";
    return [...base, name];
  };
  const visit = (node: ASTNode): void => {
    // Every write form counts: `[Math.max] = …`, `for (JSON.stringify of …)`, `[parseInt] = …` (RT-M1).
    for (const target of writtenTargets(node)) {
      const path = pathOf(target);
      const relative = path !== undefined && GLOBAL_OBJECTS.has(path[0]!) ? path.slice(1) : path;
      if (relative !== undefined && relative.length > 0 && STANDARD_GLOBALS.has(relative[0]!)) paths.add(relative.join("."));
    }
    for (const child of node.children) visit(child);
  };
  visit(ast.root);
  for (const write of aliasedWrites(ast.root, new Map())) {
    if (write.specifier === undefined && write.path.length > 0 && STANDARD_GLOBALS.has(write.path[0]!)) paths.add(write.path.join("."));
  }
  return [...paths].sort(compareCodePoints);
}

/** A value's origin: a path from the global object (`specifier` undefined) or from a package's module value. */
interface ValueRoot { readonly specifier?: string; readonly path: readonly string[] }

/** The reflective calls that write (or, `Reflect.deleteProperty`, remove: RT-L3) properties of their first argument. */
const PROPERTY_WRITERS: ReadonlySet<string> = new Set(["Object.assign", "Object.defineProperty", "Object.defineProperties", "Reflect.defineProperty", "Reflect.set", "Reflect.deleteProperty"]);

/**
 * XB-03: the paths a file writes through a name other than the root, or by reflection, each from its root and cut
 * after a computed member (`*`):
 * - through an alias: `const c = console; c.log = …` writes `console.log`, `var AP = Array.prototype; AP.includes = …`
 *   writes `Array.prototype.includes`, `const p = path; p.join = …` writes the package's `join`. An alias is a name
 *   declared with such a value, followed through chains, and never assigned anywhere in the file;
 * - by `Object.assign(t, { k })`, `Object.defineProperties(t, { k })`, `Object.defineProperty(t, "k", …)`,
 *   `Reflect.defineProperty` or `Reflect.set` on such a target, aliased or not: each literal key, or `t.*` when a key
 *   is not known.
 * Names are matched in the whole file, whatever their scope, which only over-approximates: a write recorded wrongly
 * can only keep a call UNRESOLVED. `moduleImports` maps import names to their package value.
 */
function aliasedWrites(root: ASTNode, moduleImports: ReadonlyMap<string, ValueRoot>): readonly ValueRoot[] {
  const declared = new Map<string, ASTNode[]>();
  const assigned = new Set<string>();
  const assignments: ASTNode[] = [];
  const calls: ASTNode[] = [];
  const collect = (node: ASTNode): void => {
    if (node.type === "VariableDeclarator") {
      const id = node.children.find((child) => child.role === "id");
      const init = node.children.find((child) => child.role === "init");
      const name = id?.type === "Identifier" ? identifier(id) : undefined;
      if (name !== undefined && init !== undefined) declared.set(name, [...(declared.get(name) ?? []), init]);
    }
    // Every write form (RT-M1): a member target is a write through its object, a name target reassigns an alias.
    for (const target of writtenTargets(node)) {
      if (target.type === "Identifier") { const name = identifier(target); if (name !== undefined) assigned.add(name); }
      else assignments.push(target);
    }
    if (node.type === "CallExpression" || node.type === "OptionalCallExpression") calls.push(node);
    for (const child of node.children) collect(child);
  };
  collect(root);

  const aliases = new Map<string, ValueRoot[]>();
  const rootsOf = (node: ASTNode | undefined): ValueRoot[] => {
    if (node === undefined) return [];
    if (node.type === "Identifier") {
      const name = identifier(node);
      if (name === undefined) return [];
      const roots = [...(aliases.get(name) ?? [])];
      const imported = moduleImports.get(name);
      if (imported !== undefined) roots.push(imported);
      if (GLOBAL_OBJECTS.has(name)) roots.push({ path: [] });
      if (STANDARD_GLOBALS.has(name)) roots.push({ path: [name] });
      return roots;
    }
    if (node.type === "CallExpression") {
      const specifier = requiredSpecifier(node);
      return specifier === undefined ? [] : [{ specifier, path: [] }];
    }
    if (node.type !== "MemberExpression" && node.type !== "OptionalMemberExpression") return [];
    const property = node.children.find((child) => child.role === "property");
    const name = node.attributes.computed === true ? staticPropertyKey(property) ?? "*" : identifier(property) ?? "*";
    return rootsOf(node.children.find((child) => child.role === "object")).map((base) => ({ ...base, path: [...base.path, name] }));
  };
  const key = (value: ValueRoot): string => `${value.specifier ?? ""}\u0000${value.path.join(".")}`;
  // Follow alias chains (`var a = Array; var p = a.prototype`) until no alias gains a root. A name declared from
  // itself (`var a = console; var a = a.x`) gains one root per round, so chains are followed at most ten deep.
  for (let changed = true, round = 0; changed && round < 10; round++) {
    changed = false;
    for (const [name, inits] of declared) {
      if (assigned.has(name)) continue;
      const known = new Set((aliases.get(name) ?? []).map(key));
      const found = inits.flatMap((init) => rootsOf(init)).filter((value) => !known.has(key(value)) && (known.add(key(value)), true));
      if (found.length > 0) { aliases.set(name, [...(aliases.get(name) ?? []), ...found]); changed = true; }
    }
  }

  const writes: ValueRoot[] = [];
  const add = (target: ASTNode | undefined, member: string): void => {
    for (const base of rootsOf(target)) {
      const path = [...base.path, member];
      const cut = path.indexOf("*");
      writes.push({ ...base, path: cut < 0 ? path : path.slice(0, cut + 1) });
    }
  };
  const addKeys = (target: ASTNode | undefined, source: ASTNode | undefined): void => {
    if (source?.type !== "ObjectExpression") { add(target, "*"); return; }
    for (const property of source.children) {
      add(target, property.type === "ObjectProperty" || property.type === "ObjectMethod" ? propertyKeyName(property) ?? "*" : "*");
    }
  };
  for (const left of assignments) {
    const property = left.children.find((child) => child.role === "property");
    add(left.children.find((child) => child.role === "object"), left.attributes.computed === true ? staticPropertyKey(property) ?? "*" : identifier(property) ?? "*");
  }
  for (const call of calls) {
    const writer = memberPathOf(call.children.find((child) => child.role === "callee"))?.join(".");
    if (writer === undefined || !PROPERTY_WRITERS.has(writer)) continue;
    const args = call.children.filter((child) => child.role === "arguments");
    if (args.some((arg) => arg.type === "SpreadElement")) { add(args[0], "*"); continue; }
    if (writer === "Object.assign") for (const source of args.slice(1)) addKeys(args[0], source);
    else if (writer === "Object.defineProperties") addKeys(args[0], args[1]);
    else add(args[0], staticPropertyKey(args[1]) ?? "*");
  }
  return writes;
}

/** RT-L7: the specifier of a re-export of a standard global (`module.exports = JSON`). */
const GLOBAL_VALUE = "\u0000global";

/**
 * RT-L7: the global writes made through repository wrappers, from packageWriteKeys: a write on a module that
 * re-exports a standard global (`module.exports = JSON`) is a global write of that path.
 */
export function wrapperGlobalWrites(packageWrites: ReadonlySet<string>): readonly string[] {
  const paths: string[] = [];
  for (const key of packageWrites) {
    const separator = key.lastIndexOf("\u0000");
    const module = key.slice(0, separator);
    const member = key.slice(separator + 1);
    if (module === GLOBAL_VALUE && member.length > 0) paths.push(member);
  }
  return paths;
}

/**
 * The package members a run's files write (`require("fs").readFileSync = …`, `fs.readFileSync = …` through an import):
 * keys `module\u0000member`, `*` for a computed member, the member being the whole written path when known
 * (`ObjectId.prototype._id`). A specifier that resolves to a repository file is not a package, but a write on it is a
 * write on every package value that file's exports object may hold (RT-L7, see exportsValueRoots), followed through
 * files that re-export other files. A relative specifier that reaches no repository file is not followed.
 */
export function packageWriteKeys(writes: readonly ForeignExportWrite[], resolveFile: (importerPath: string, specifier: string) => string | undefined): ReadonlySet<string> {
  const keys = new Set<string>();
  const reexports = new Map<string, ForeignExportWrite[]>();
  for (const write of writes) if (write.reexport === true) reexports.set(write.importerPath, [...(reexports.get(write.importerPath) ?? []), write]);
  // `chain` holds the files on the current re-export path only, so a file reached twice along sibling paths keeps both.
  const packagesOf = (file: string, chain: ReadonlySet<string>): Array<{ readonly module: string; readonly path: readonly string[] }> => {
    if (chain.has(file)) return [];
    const next = new Set([...chain, file]);
    return (reexports.get(file) ?? []).flatMap((entry) => {
      const path = entry.member === undefined || entry.member === "" ? [] : entry.member.split(".");
      if (entry.specifier === GLOBAL_VALUE) return [{ module: GLOBAL_VALUE, path }];
      const target = resolveFile(file, entry.specifier);
      if (target === undefined) return isRelativeSpecifier(entry.specifier) ? [] : [{ module: packageName(entry.specifier), path }];
      return packagesOf(canonicalizePath(target), next).map((found) => ({ module: found.module, path: [...found.path, ...path] }));
    });
  };
  for (const write of writes) {
    if (write.reexport === true) continue;
    const written = write.member ?? write.name;
    const target = resolveFile(write.importerPath, write.specifier);
    if (target === undefined) {
      if (!isRelativeSpecifier(write.specifier)) keys.add(`${packageName(write.specifier)}\u0000${written}`);
      continue;
    }
    for (const found of packagesOf(canonicalizePath(target), new Set())) keys.add(`${found.module}\u0000${[...found.path, written].filter((piece) => piece.length > 0).join(".")}`);
  }
  return keys;
}
