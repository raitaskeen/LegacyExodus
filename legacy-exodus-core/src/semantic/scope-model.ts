/** Scope frames, source positions and small AST name helpers shared by the call-graph modules. Imports none of them. */
import type { ASTNode } from "@parser/index";
import { createLexicalScopeId, createSelfScopeId, type CodeSymbol } from "@symbols/index";
import { immutable } from "@shared/immutability";

export interface SourcePoint {
  readonly line: number;
  readonly column: number;
}

export const MODULE_SCOPE_ID = "scope:module";

export interface ScopeFrame {
  readonly id: string;
  readonly parent?: ScopeFrame;
  /** Name a named function or class expression binds to itself, visible only inside it. */
  readonly selfName?: string;
}

export function createScope(id: string, parent?: ScopeFrame, selfName?: string): ScopeFrame {
  return immutable({ id, ...(parent === undefined ? {} : { parent }), ...(selfName === undefined ? {} : { selfName }) });
}

export function createsScope(node: ASTNode): boolean {
  return node.type === "BlockStatement" || isCallable(node) || node.type === "CatchClause" || isLoop(node) || node.type === "TSModuleDeclaration"
    || node.type === "SwitchStatement" || node.type === "StaticBlock";
}

/**
 * Frame in which `node`'s own code runs. A named function or class expression binds its name
 * in a frame of its own between the enclosing frame and its body, where parameters and body
 * declarations can still shadow it. Frame ids match the symbol extractor's scope ids.
 */
export function frameFor(node: ASTNode, enclosing: ScopeFrame): ScopeFrame {
  const selfName = node.type === "FunctionExpression" || node.type === "ClassExpression"
    ? identifier(node.children.find((child) => child.role === "id"))
    : undefined;
  const outer = selfName === undefined
    ? enclosing
    : createScope(createSelfScopeId(node.type, node.location), enclosing, selfName);
  return createsScope(node) ? createScope(createLexicalScopeId(node.type, node.location), outer) : outer;
}

/** Static name of the property a member expression reads or writes: `#name` for private names. */
export function memberPropertyName(member: ASTNode): string | undefined {
  const property = member.children.find((child) => child.role === "property");
  if (member.attributes.computed === true) return staticPropertyKey(property);
  if (property?.type === "PrivateName") {
    const name = identifier(property);
    return name === undefined ? undefined : `#${name}`;
  }
  return identifier(property);
}

/** Name of a class member or field: `#name` for private names. */
export function classElementName(element: ASTNode): string | undefined {
  const key = element.children.find((child) => child.role === "key");
  if (key?.type !== "PrivateName") return propertyKeyName(element);
  const name = identifier(key);
  return name === undefined ? undefined : `#${name}`;
}

export function propertyKeyName(property: ASTNode): string | undefined {
  const key = property.children.find((child) => child.role === "key");
  return property.attributes.computed === true ? staticPropertyKey(key) : key?.type === "Identifier" ? identifier(key) : staticPropertyKey(key);
}

/**
 * A key known without running code (RT-M2): a string or numeric literal, or a template literal without substitutions,
 * so `` o[`m`] `` and `o["m"]` both name `m`, as they do at run time.
 */
export function staticPropertyKey(node: ASTNode | undefined): string | undefined {
  if (node?.type === "NumericLiteral" && typeof node.attributes.value === "number") return String(node.attributes.value);
  return extractStaticString(node);
}

/** An identifier that names no binding: a non-computed member or key name, or a label. */
export function isNonReferenceName(node: ASTNode, parent: ASTNode | undefined): boolean {
  if (parent === undefined) return false;
  if (node.role === "label") return true;
  if (node.role === "property") return parent.attributes.computed !== true && (parent.type === "MemberExpression" || parent.type === "OptionalMemberExpression");
  return node.role === "key" && parent.attributes.computed !== true && parent.attributes.shorthand !== true;
}

export function comparePoints(left: SourcePoint, right: SourcePoint): number {
  return left.line - right.line || left.column - right.column;
}

export function bindingWriteKey(scopeId: string, name: string): string {
  return `${scopeId}:${name}`;
}

export function declarationAnchor(location: CodeSymbol["location"]): string | undefined {
  if (location === undefined) return undefined;
  return `${location.start.line}:${location.start.column}:${location.end.line}:${location.end.column}`;
}

export function lexicalBindingKey(scopeId: string, name: string): string {
  return `${scopeId}\u0000${name}`;
}

export function isCallable(node: ASTNode): boolean {
  return ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ClassMethod", "ClassPrivateMethod", "ObjectMethod"].includes(node.type);
}

function isLoop(node: ASTNode): boolean {
  return ["ForStatement", "ForInStatement", "ForOfStatement"].includes(node.type);
}

export function nodeName(node: ASTNode): string | undefined {
  return identifier(node.children.find((child) => child.role === "id" || child.role === "key")) ?? identifier(node);
}

export function identifier(node: ASTNode | undefined): string | undefined {
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

export function extractBoundNames(node: ASTNode | undefined): string[] {
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

export function extractStaticString(node: ASTNode | undefined): string | undefined {
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

/**
 * Standard JavaScript and Node globals a call can reach without an import (ADR-012, Phase B1b). Test-framework globals
 * (`describe`, `it`, `expect`) are not here: a runner injects them, which the repository cannot show. `eval` and
 * `Function` are left out: they run code the analysis cannot see.
 */
export const STANDARD_GLOBALS: ReadonlySet<string> = new Set([
  "Object", "Array", "String", "Number", "Boolean", "Symbol", "BigInt", "Math", "JSON", "Date", "RegExp", "Intl", "Reflect", "Proxy",
  "Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "EvalError", "URIError", "AggregateError",
  "Promise", "Map", "Set", "WeakMap", "WeakSet", "WeakRef", "FinalizationRegistry",
  "ArrayBuffer", "SharedArrayBuffer", "DataView", "Atomics", "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array",
  "Int32Array", "Uint32Array", "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array",
  "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURI", "encodeURIComponent", "decodeURI", "decodeURIComponent",
  "console", "setTimeout", "setInterval", "setImmediate", "clearTimeout", "clearInterval", "clearImmediate", "queueMicrotask",
  "structuredClone", "process", "Buffer", "URL", "URLSearchParams", "TextEncoder", "TextDecoder", "AbortController", "AbortSignal",
  "fetch", "atob", "btoa", "performance",
]);

/** A member path rooted at an identifier (`Array.isArray`, `Object.prototype.toString`), or undefined. */
export function memberPathOf(node: ASTNode | undefined): string[] | undefined {
  if (node === undefined) return undefined;
  if (node.type === "Identifier") { const name = identifier(node); return name === undefined ? undefined : [name]; }
  if (node.type !== "MemberExpression" || node.attributes.computed === true) return undefined;
  const base = memberPathOf(node.children.find((child) => child.role === "object"));
  const property = identifier(node.children.find((child) => child.role === "property"));
  return base === undefined || property === undefined ? undefined : [...base, property];
}

/** A package or Node module specifier without the `node:` scheme: `node:fs` and `fs` are one module. */
export function packageName(specifier: string): string {
  return specifier.startsWith("node:") ? specifier.slice(5) : specifier;
}

/** A specifier naming a file (`./x`, `../x`, `/x`) rather than a package; an unknown one counts as a file. */
export function isRelativeSpecifier(specifier: string | undefined): boolean {
  return specifier === undefined || specifier.startsWith(".") || specifier.startsWith("/");
}
