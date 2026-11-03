import type { ASTNode } from "@parser/index";

import type { LexicalBindings } from "./lexical-bindings";

/**
 * The built-in taint policy (BA-07), versioned, keyed by what names resolve to, not how they are
 * spelled:
 * - Node core sinks reached through their module's import or `require`, under any local name
 *   (`const { exec } = require("child_process")`, `import * as cp from "node:child_process"`), and the
 *   global `eval` / `Function`;
 * - Express request sources and response sinks on the parameters of proven route handlers, whatever
 *   the parameters are called;
 * - sanitizers from their own modules.
 * The conventional spellings `req`, `res`, `child_process.exec`, `validator.escape` and `sanitize`
 * still match, so code that does not wire handlers visibly (a handler exported to another file) keeps
 * its flows. Unknown calls are neither sources nor sinks.
 */
export const TAINT_POLICY_VERSION = "builtin-1";

const REQUEST_SOURCES = new Set(["body", "params", "query", "headers", "cookies", "signedCookies", "files"]);
const REQUEST_SOURCE_METHODS = new Set(["get", "header", "param"]);
const RESPONSE_SINKS = new Set(["send", "json", "jsonp", "write", "end", "redirect", "render", "sendFile", "download"]);
const PROCESS_SOURCES = new Set(["env", "argv"]);
const MODULE_SINKS: Readonly<Record<string, ReadonlySet<string>>> = {
  child_process: new Set(["exec", "execSync", "execFile", "execFileSync", "spawn", "spawnSync", "fork"]),
  vm: new Set(["runInThisContext", "runInNewContext", "runInContext", "compileFunction"]),
};
const MODULE_SANITIZERS: Readonly<Record<string, ReadonlySet<string>>> = {
  validator: new Set(["escape"]),
  "escape-html": new Set(["default"]),
  dompurify: new Set(["sanitize"]),
  "isomorphic-dompurify": new Set(["sanitize"]),
};
const SPELLED_SANITIZERS = new Set(["sanitize", "validator.escape"]);
const ROUTE_METHODS = new Set(["get", "post", "put", "patch", "delete", "all", "use", "options", "head"]);

export interface FilePolicy {
  /** Canonical source path (`req.body.x`, `process.env.X`, `req.get`) of a member read or request-method call. */
  sourcePath(node: ASTNode): string | undefined;
  /** Canonical source path of `keys` destructured from `object` (`const { body } = req`). */
  destructuredSourcePath(object: ASTNode, keys: readonly string[]): string | undefined;
  /** Canonical sink name of a call, e.g. `child_process.exec` for a local `exec`. */
  sinkName(call: ASTNode): string | undefined;
  isSanitizer(call: ASTNode): boolean;
}

interface ModuleBinding { readonly module: string; readonly member: string }

function role(node: ASTNode, name: string): ASTNode | undefined { return node.children.find((child) => child.role === name); }
function nameOf(node: ASTNode | undefined): string | undefined { const value = node?.attributes.name; return typeof value === "string" && value.length > 0 ? value : undefined; }
function stringOf(node: ASTNode | undefined): string | undefined { const value = node?.attributes.value; return typeof value === "string" ? value : undefined; }
function moduleName(specifier: string): string { return specifier.startsWith("node:") ? specifier.slice(5) : specifier; }
const FUNCTION_TYPES = new Set(["FunctionExpression", "ArrowFunctionExpression", "FunctionDeclaration"]);

/** `require("m")` → "m". */
function requiredModule(node: ASTNode | undefined): string | undefined {
  if (node?.type !== "CallExpression" || nameOf(role(node, "callee")) !== "require") return undefined;
  const specifier = stringOf(node.children.find((child) => child.role === "arguments"));
  return specifier === undefined ? undefined : moduleName(specifier);
}

/** Base identifier and static property names of `a.b["c"].d`; a computed non-literal key ends the path. */
function staticPath(node: ASTNode): { readonly base: ASTNode; readonly properties: readonly string[] } | undefined {
  const properties: string[] = [];
  let current = node;
  while (current.type === "MemberExpression" || current.type === "OptionalMemberExpression") {
    const property = role(current, "property");
    const name = current.attributes.computed === true ? stringOf(property) : nameOf(property);
    if (name === undefined) properties.length = 0;
    else properties.unshift(name);
    const object = role(current, "object");
    if (object === undefined) return undefined;
    current = object;
  }
  return current.type === "Identifier" ? { base: current, properties } : undefined;
}

export function filePolicy(root: ASTNode, bindings: LexicalBindings): FilePolicy {
  const keyOf = (node: ASTNode | undefined): string | undefined => (node === undefined ? undefined : bindings.keyOf.get(node));
  const modules = new Map<string, ModuleBinding>();
  const functionsByKey = new Map<string, ASTNode>();
  const declarators: ASTNode[] = [];
  const calls: ASTNode[] = [];
  const visit = (node: ASTNode): void => {
    if (node.type === "ImportDeclaration") {
      const specifier = stringOf(role(node, "source"));
      if (specifier !== undefined) {
        for (const imported of node.children) {
          const local = role(imported, "local");
          const key = keyOf(local);
          if (key === undefined) continue;
          const member = imported.type === "ImportDefaultSpecifier" ? "default"
            : imported.type === "ImportNamespaceSpecifier" ? "*"
              : nameOf(role(imported, "imported")) ?? stringOf(role(imported, "imported"));
          if (member !== undefined) modules.set(key, { module: moduleName(specifier), member });
        }
      }
    }
    if (node.type === "VariableDeclarator") declarators.push(node);
    if (node.type === "FunctionDeclaration") { const key = keyOf(role(node, "id")); if (key !== undefined) functionsByKey.set(key, node); }
    if (node.type === "CallExpression") calls.push(node);
    for (const child of node.children) visit(child);
  };
  visit(root);

  // `const m = require("x")`, `const { a } = require("x")`, `const a = require("x").a`.
  for (const declarator of declarators) {
    const id = role(declarator, "id");
    const init = role(declarator, "init");
    if (id === undefined || init === undefined) continue;
    const whole = requiredModule(init);
    const member = init.type === "MemberExpression" && init.attributes.computed !== true ? requiredModule(role(init, "object")) : undefined;
    if (whole !== undefined && id.type === "Identifier") { const key = keyOf(id); if (key !== undefined) modules.set(key, { module: whole, member: "*" }); }
    if (whole !== undefined && id.type === "ObjectPattern") {
      for (const property of id.children) {
        if (property.type !== "ObjectProperty" || property.attributes.computed === true) continue;
        const name = nameOf(role(property, "key")) ?? stringOf(role(property, "key"));
        const key = keyOf(role(property, "value"));
        if (name !== undefined && key !== undefined) modules.set(key, { module: whole, member: name });
      }
    }
    if (member !== undefined && id.type === "Identifier") {
      const name = nameOf(role(init, "property"));
      const key = keyOf(id);
      if (name !== undefined && key !== undefined) modules.set(key, { module: member, member: name });
    }
  }

  const moduleOf = (node: ASTNode | undefined): ModuleBinding | undefined => {
    if (node === undefined) return undefined;
    const required = requiredModule(node);
    if (required !== undefined) return { module: required, member: "*" };
    const key = keyOf(node);
    return key === undefined ? undefined : modules.get(key);
  };

  // Express apps and routers: `express()`, `require("express")()`, `express.Router()`, `Router()`.
  const isExpressFactory = (callee: ASTNode | undefined): boolean => {
    if (callee === undefined) return false;
    const direct = moduleOf(callee);
    if (direct?.module === "express" && (direct.member === "*" || direct.member === "default" || direct.member === "Router")) return true;
    if (callee.type === "MemberExpression" && nameOf(role(callee, "property")) === "Router") {
      const object = moduleOf(role(callee, "object"));
      return object?.module === "express" && (object.member === "*" || object.member === "default");
    }
    return false;
  };
  const receivers = new Set<string>();
  for (const declarator of declarators) {
    const init = role(declarator, "init");
    const key = keyOf(role(declarator, "id"));
    if (key !== undefined && init?.type === "CallExpression" && isExpressFactory(role(init, "callee"))) receivers.add(key);
  }

  // Parameters of proven handlers: `app.get(path, (req, res) => …)`, `router.use(handler)`.
  const requests = new Set<string>();
  const responses = new Set<string>();
  for (const call of calls) {
    const callee = role(call, "callee");
    if (callee?.type !== "MemberExpression" || callee.attributes.computed === true) continue;
    const receiver = keyOf(role(callee, "object"));
    const method = nameOf(role(callee, "property"));
    if (receiver === undefined || !receivers.has(receiver) || method === undefined || !ROUTE_METHODS.has(method)) continue;
    for (const argument of call.children.filter((child) => child.role === "arguments")) {
      const handler = FUNCTION_TYPES.has(argument.type) ? argument
        : argument.type === "Identifier" ? functionsByKey.get(keyOf(argument) ?? "") : undefined;
      if (handler === undefined) continue;
      const params = handler.children.filter((child) => child.role === "params");
      const [request, response] = params.length === 4 ? [params[1], params[2]] : [params[0], params[1]];
      const requestKey = request?.type === "Identifier" ? keyOf(request) : undefined;
      const responseKey = response?.type === "Identifier" ? keyOf(response) : undefined;
      if (requestKey !== undefined) requests.add(requestKey);
      if (responseKey !== undefined) responses.add(responseKey);
    }
  }

  const baseRole = (base: ASTNode): "req" | "res" | "process" | undefined => {
    const key = keyOf(base);
    const name = nameOf(base);
    if ((key !== undefined && requests.has(key)) || name === "req") return "req";
    if ((key !== undefined && responses.has(key)) || name === "res") return "res";
    if (name === "process" && key === "global:process") return "process";
    return undefined;
  };
  const sourceFor = (base: ASTNode, properties: readonly string[]): string | undefined => {
    const kind = baseRole(base);
    const first = properties[0];
    if (first === undefined) return undefined;
    if (kind === "req" && REQUEST_SOURCES.has(first)) return ["req", ...properties].join(".");
    if (kind === "process" && PROCESS_SOURCES.has(first)) return ["process", ...properties].join(".");
    return undefined;
  };

  return {
    sourcePath(node) {
      if (node.type === "CallExpression") {
        const callee = role(node, "callee");
        if (callee?.type !== "MemberExpression" || callee.attributes.computed === true) return undefined;
        const object = role(callee, "object");
        const method = nameOf(role(callee, "property"));
        return object?.type === "Identifier" && method !== undefined && REQUEST_SOURCE_METHODS.has(method) && baseRole(object) === "req" ? `req.${method}` : undefined;
      }
      if (node.type !== "MemberExpression" && node.type !== "OptionalMemberExpression") return undefined;
      const path = staticPath(node);
      return path === undefined ? undefined : sourceFor(path.base, path.properties);
    },
    destructuredSourcePath(object, keys) {
      if (object.type === "Identifier") return sourceFor(object, keys);
      const path = staticPath(object);
      return path === undefined ? undefined : sourceFor(path.base, [...path.properties, ...keys]);
    },
    sinkName(call) {
      if (call.type !== "CallExpression" && call.type !== "NewExpression") return undefined;
      const callee = role(call, "callee");
      if (callee === undefined) return undefined;
      if (callee.type === "Identifier") {
        const name = nameOf(callee);
        const key = keyOf(callee);
        if ((name === "eval" || name === "Function") && key === `global:${name}`) return name;
        const binding = moduleOf(callee);
        return binding !== undefined && MODULE_SINKS[binding.module]?.has(binding.member) ? `${binding.module}.${binding.member}` : undefined;
      }
      if (callee.type !== "MemberExpression" || callee.attributes.computed === true) return undefined;
      const method = nameOf(role(callee, "property"));
      const object = role(callee, "object");
      if (method === undefined || object === undefined) return undefined;
      if (object.type === "Identifier" && baseRole(object) === "res" && RESPONSE_SINKS.has(method)) return `res.${method}`;
      const binding = moduleOf(object);
      const module = binding !== undefined && (binding.member === "*" || binding.member === "default") ? binding.module
        : object.type === "Identifier" && nameOf(object) === "child_process" ? "child_process" : undefined;
      return module !== undefined && MODULE_SINKS[module]?.has(method) ? `${module}.${method}` : undefined;
    },
    isSanitizer(call) {
      if (call.type !== "CallExpression") return false;
      const callee = role(call, "callee");
      if (callee === undefined) return false;
      const binding = callee.type === "Identifier" ? moduleOf(callee) : undefined;
      // A required CommonJS module is its default export.
      if (binding !== undefined && MODULE_SANITIZERS[binding.module]?.has(binding.member === "*" ? "default" : binding.member)) return true;
      if (callee.type === "MemberExpression" && callee.attributes.computed !== true) {
        const method = nameOf(role(callee, "property"));
        const object = moduleOf(role(callee, "object"));
        if (method !== undefined && object !== undefined && (object.member === "*" || object.member === "default") && MODULE_SANITIZERS[object.module]?.has(method)) return true;
        const spelled = callee.type === "MemberExpression" ? `${nameOf(role(callee, "object")) ?? ""}.${method ?? ""}` : undefined;
        if (spelled !== undefined && SPELLED_SANITIZERS.has(spelled)) return true;
      }
      return callee.type === "Identifier" && SPELLED_SANITIZERS.has(nameOf(callee) ?? "");
    },
  };
}
