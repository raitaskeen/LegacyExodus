/** EXTERNAL targets: package imports, Node built-ins and standard globals. */
import type { ASTNode } from "@parser/index";
import { type CodeSymbol } from "@symbols/index";
import type { ExternalTarget } from "./semantic-contracts";
import { MODULE_SCOPE_ID, STANDARD_GLOBALS, bindingWriteKey, identifier, isRelativeSpecifier, memberPathOf, packageName } from "./scope-model";
import type { BindingWrites, FileSymbolIndex, ResolutionContext } from "./call-graph-types";
import { assignedValue, declaredBindingFrame, isLexicallyShadowed, isRebound, isUnboundName, propertyWriteCount, visibleImport } from "./binding-queries";

/**
 * Where a call goes when it is proven to leave the repository through an import (ADR-012): its callee, or the object it
 * reads the callee from, is an import of a package or Node module whose binding is never rebound, and no file of the run
 * writes that member of that module. A member chain is kept as written (`promises.readFile`).
 */
export function externalTarget(imported: CodeSymbol | undefined, calleeName: string, index: FileSymbolIndex, context: ResolutionContext, packageWrites: ReadonlySet<string>): ExternalTarget | undefined {
  const pieces = calleeName.split(".");
  const root = pieces[0] ?? calleeName;
  const binding = imported !== undefined
    ? imported
    : pieces.length > 1 && root !== "this" && !isLexicallyShadowed(root, context, index) ? visibleImport(index, root, context.scope) : undefined;
  if (binding === undefined || binding.kind !== "import" || isRepositoryImport(index, binding.moduleSpecifier)) return undefined;
  if (binding.scopeId === MODULE_SCOPE_ID && isRebound(index, MODULE_SCOPE_ID, binding.name)) return undefined;
  const module = packageName(binding.moduleSpecifier!);
  const source = binding.sourceSymbolName;
  const whole = source === "*" || (binding.defaultExport && source === undefined);
  const path = [...(whole ? [] : [source ?? binding.name]), ...(imported !== undefined ? [] : pieces.slice(1))];
  const member = path.length === 0 ? "default" : path.join(".");
  if (!packagePathUnwritten(module, path.length === 0 ? ["default"] : path, packageWrites)) return undefined;
  return { module, member };
}

/** For each file being built, whether a specifier names repository code (`#x`, a workspace package, its own package). */
export const repositoryPackageImports = new WeakMap<FileSymbolIndex, (specifier: string) => boolean>();

/**
 * An import that loads repository code, by a relative path or by a name the resolver knows as the repository's (RT-M6):
 * never a call into a package, even when no one file can be named for it.
 */
export function isRepositoryImport(index: FileSymbolIndex, specifier: string | undefined): boolean {
  return isRelativeSpecifier(specifier) || repositoryPackageImports.get(index)?.(specifier!) === true;
}

/**
 * Where a call goes when its root is a standard global (ADR-012, Phase B1b): no declaration, parameter or import binds
 * the root in the file, and no file of the run writes the path called or any part of it (`console.log`, `console`,
 * `console.*`). `require(…)` is the CommonJS module wrapper's own function in a CommonJS file.
 */
export function globalTarget(calleeName: string, index: FileSymbolIndex, context: ResolutionContext, globalWrites: ReadonlySet<string>, commonJs: boolean): ExternalTarget | undefined {
  const pieces = calleeName.split(".");
  const root = pieces[0] ?? calleeName;
  if (calleeName === "require") {
    return commonJs && isUnboundName(index, "require", context) ? { module: "commonjs", member: "require" } : undefined;
  }
  if (!STANDARD_GLOBALS.has(root) || pieces.some((piece) => piece.length === 0 || piece.includes("[") || piece.includes("("))) return undefined;
  if (!isUnboundName(index, root, context)) return undefined;
  for (let length = 1; length <= pieces.length; length++) {
    const prefix = pieces.slice(0, length).join(".");
    if (globalWrites.has(prefix) || globalWrites.has(`${prefix}.*`)) return undefined;
  }
  return { module: "global", member: calleeName };
}

/** The target of each call resolved so far in a file, by call node: a factory call's result is looked up here (C1). */
export const resolvedCallTargets = new WeakMap<FileSymbolIndex, Map<ASTNode, string>>();

/**
 * Built-in prototype methods, by the constructor whose instances a literal or `new` makes (ADR-012, Phase B1c). Only
 * methods that every instance inherits are listed; an own property of the same name is excluded by the write check.
 */
const BUILTIN_METHODS: Readonly<Record<string, ReadonlySet<string>>> = {
  Array: new Set(["at", "concat", "copyWithin", "entries", "every", "fill", "filter", "find", "findIndex", "findLast", "findLastIndex", "flat", "flatMap",
    "forEach", "includes", "indexOf", "join", "keys", "lastIndexOf", "map", "pop", "push", "reduce", "reduceRight", "reverse", "shift", "slice", "some",
    "sort", "splice", "toReversed", "toSorted", "toSpliced", "unshift", "values", "with"]),
  String: new Set(["at", "charAt", "charCodeAt", "codePointAt", "concat", "endsWith", "includes", "indexOf", "lastIndexOf", "localeCompare", "match",
    "matchAll", "normalize", "padEnd", "padStart", "repeat", "replace", "replaceAll", "search", "slice", "split", "startsWith", "substring", "substr",
    "toLocaleLowerCase", "toLocaleUpperCase", "toLowerCase", "toUpperCase", "trim", "trimEnd", "trimStart"]),
  RegExp: new Set(["exec", "test"]),
  Map: new Set(["clear", "delete", "entries", "forEach", "get", "has", "keys", "set", "values"]),
  Set: new Set(["add", "clear", "delete", "entries", "forEach", "has", "keys", "values"]),
  WeakMap: new Set(["delete", "get", "has", "set"]),
  WeakSet: new Set(["add", "delete", "has"]),
  Date: new Set(["getDate", "getDay", "getFullYear", "getHours", "getMilliseconds", "getMinutes", "getMonth", "getSeconds", "getTime",
    "getTimezoneOffset", "toISOString", "toJSON", "toUTCString"]),
  URLSearchParams: new Set(["append", "delete", "entries", "forEach", "get", "getAll", "has", "keys", "set", "sort", "values"]),
};

/** The built-in a literal or `new` expression makes: `[]` an Array, `""` a String, `new Map()` a Map (the global, unbound). */
function builtinKind(value: ASTNode | undefined, index: FileSymbolIndex, context: ResolutionContext): string | undefined {
  if (value === undefined) return undefined;
  if (value.type === "ArrayExpression") return "Array";
  if (value.type === "StringLiteral" || value.type === "TemplateLiteral") return "String";
  if (value.type === "RegExpLiteral") return "RegExp";
  if (value.type === "NewExpression") {
    const callee = value.children.find((child) => child.role === "callee");
    const name = callee?.type === "Identifier" ? identifier(callee) : undefined;
    return name !== undefined && BUILTIN_METHODS[name] !== undefined && isUnboundName(index, name, context) ? name : undefined;
  }
  return undefined;
}

/** Whether no file of the run writes `path` or any part of it (see collectGlobalWrites). */
export function globalPathUnwritten(path: readonly string[], globalWrites: ReadonlySet<string>): boolean {
  for (let length = 1; length <= path.length; length++) {
    const prefix = path.slice(0, length).join(".");
    if (globalWrites.has(prefix) || globalWrites.has(`${prefix}.*`)) return false;
  }
  return true;
}

/**
 * Phase C3b: `x.m()` with `x` bound once to a factory call whose object got `m` from a known built-in prototype by a
 * copy (`mixin(app, EventEmitter.prototype, false)`): EXTERNAL, `events:EventEmitter.prototype.on`.
 */
export function factoryExternalTarget(calleeName: string, index: FileSymbolIndex, context: ResolutionContext): ExternalTarget | undefined {
  const pieces = calleeName.split(".");
  if (pieces.length !== 2 || context.factories === undefined) return undefined;
  const [receiver, method] = pieces as [string, string];
  if (receiver === "this" || receiver.length === 0 || method.length === 0) return undefined;
  const frame = declaredBindingFrame(index, receiver, context.scope);
  if (frame === undefined || isRebound(index, frame.id, receiver)) return undefined;
  const init = assignedValue(index.writes.declaredValues.get(bindingWriteKey(frame.id, receiver)));
  const producer = init?.type === "CallExpression" ? resolvedCallTargets.get(index)?.get(init) : undefined;
  if (producer === undefined || propertyWriteCount(index, method) > 0) return undefined;
  return context.factories.externalOf(producer, method);
}

/**
 * Where a call goes through a binding whose value is proven built-in (ADR-012, Phase B1c), the binding being written once:
 * - an alias of a standard global's path: `var isArray = Array.isArray; isArray(x)` calls `Array.isArray`;
 * - a built-in method on a literal or `new` value: `const out = []; out.push(x)` calls `Array.prototype.push`, when the
 *   file writes no property of that name and no file writes the built-in's prototype or the method on it.
 * A computed write (`out[i] = …`) is assumed not to produce the method's name, as elsewhere.
 */
export function valueTarget(calleeName: string, index: FileSymbolIndex, context: ResolutionContext, globalWrites: ReadonlySet<string>): ExternalTarget | undefined {
  const pieces = calleeName.split(".");
  if (pieces.length > 2 || pieces.some((piece) => piece.length === 0 || piece.includes("[") || piece.includes("("))) return undefined;
  const name = pieces[0]!;
  if (name === "this") return undefined;
  const frame = declaredBindingFrame(index, name, context.scope);
  if (frame === undefined || isRebound(index, frame.id, name)) return undefined;
  const value = index.writes.declaredValues.get(bindingWriteKey(frame.id, name));
  if (pieces.length === 1) {
    const path = value?.type === "MemberExpression" ? memberPathOf(value) : undefined;
    if (path === undefined || path.length < 2 || !STANDARD_GLOBALS.has(path[0]!) || !isUnboundName(index, path[0]!, context)) return undefined;
    return globalPathUnwritten(path, globalWrites) ? { module: "global", member: path.join(".") } : undefined;
  }
  const method = pieces[1]!;
  const kind = builtinKind(value, index, context);
  if (kind === undefined || !BUILTIN_METHODS[kind]!.has(method)) return undefined;
  if ((index.writes.propertyWrites.get(method) ?? 0) > 0) return undefined;
  // RT-M5: a prototype swap of the binding, or a reflective write in the file once the value is passed around, may give
  // the object its own `method`. A string primitive cannot hold own properties.
  const key = bindingWriteKey(frame.id, name);
  // A writer handed on any other way (`fn(Object)`) is assumed, like a parameter receiving the value, not to reach it.
  if (kind !== "String" && reflectivelyTargeted(index.writes, key)) return undefined;
  return globalPathUnwritten([kind, "prototype", method], globalWrites) ? { module: "global", member: `${kind}.prototype.${method}` } : undefined;
}

/**
 * RT-M5, option (2): whether a prototype swap or an unknown reflective write names binding `key`, or a plain alias of
 * it (`const a = out`), as its target. A parameter, a call result or `this` that receives the value is assumed not to
 * change its prototype or methods reflectively, as XB-03 assumes for globals and packages.
 */
function reflectivelyTargeted(writes: BindingWrites, key: string): boolean {
  const seen = new Set<string>();
  const pending = [key];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    if (writes.protoSwapTargets.has(current) || writes.reflectiveTargets.has(current)) return true;
    for (const [alias, sources] of writes.aliasSources) if (sources.has(current)) pending.push(alias);
  }
  return false;
}

/**
 * Whether no file of the run writes member `path` of package `module` or a part of it (see packageWriteKeys), as for
 * globals: `x.a = …` and `x.a.*` block `x.a.b()`, while `x.a.prototype.c = …` leaves the call `x.a()` alone.
 */
function packagePathUnwritten(module: string, path: readonly string[], packageWrites: ReadonlySet<string>): boolean {
  if (packageWrites.has(`${module}\u0000*`)) return false;
  for (let length = 1; length <= path.length; length++) {
    const prefix = path.slice(0, length).join(".");
    if (packageWrites.has(`${module}\u0000${prefix}`) || packageWrites.has(`${module}\u0000${prefix}.*`)) return false;
  }
  return true;
}
