/**
 * Per-file binding writes (collectBindingWrites): which bindings are rebound or written by property, the value a
 * binding is declared with, and where calls and writes run.
 */
import type { ASTNode } from "@parser/index";
import { type CodeSymbol } from "@symbols/index";
import { immutable } from "@shared/immutability";
import { MODULE_SCOPE_ID, type ScopeFrame, type SourcePoint, bindingWriteKey, classElementName, comparePoints, createScope, declarationAnchor, extractBoundNames, frameFor, identifier, isCallable, isNonReferenceName, lexicalBindingKey, memberPropertyName, nodeName, propertyKeyName, staticPropertyKey } from "./scope-model";
import type { BindingWrites, ExecutionSite, WriteSite } from "./call-graph-types";

const classElementContexts = new Set(["ClassProperty", "ClassPrivateProperty", "PropertyDefinition", "ClassAccessorProperty", "StaticBlock"]);
const loopStatements = new Set(["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"]);

interface WriteWalk {
  readonly scope: ScopeFrame;
  readonly contextId: string;
  readonly loopIds: readonly string[];
  readonly unconditional: boolean;
  /** The branch, loop part, `try` part, `switch` case or label body the walk last entered in its context, and the scope around it (RT-L2). */
  readonly guard: { readonly scope: ScopeFrame; readonly node: ASTNode } | undefined;
}

/**
 * Records every write that can change which function a binding or property names,
 * with where and under which control it executes. Scope frames mirror `childContext`,
 * so keys match the resolver's binding keys. Assumes no `eval`/`with`, no mutation of
 * this module's objects by other modules (including property-copying helpers such as
 * `mixin` or `_.extend`), and that the `Object`/`Reflect` builtins are not reached
 * through other objects (`globalThis.Object`).
 */
export function collectBindingWrites(root: ASTNode, byScopeAndName: ReadonlyMap<string, readonly CodeSymbol[]>): BindingWrites {
  const reboundBindings = new Set<string>();
  const declarations = new Map<string, number>();
  const propertyWrites = new Map<string, number>();
  let unknownPropertyWrites = false;
  let unknownReflectiveWrites = false;
  const protoSwapTargets = new Set<string>();
  const escapedNames = new Set<string>();
  const reflectiveTargets = new Set<string>();
  const aliasSources = new Map<string, Set<string>>();
  let escapedReflectiveWriters = false;
  const writerAliases = new Set<string>();
  // Counts unknown reflective writes, so a call can tell whether it made one (and record its target).
  let reflectiveCount = 0;
  const propertyWriteSites = new Map<string, WriteSite[]>();
  const declaredValues = new Map<string, ASTNode>();
  const writeSites = new Map<string, WriteSite[]>();
  const declaringContext = new Map<string, string>();
  const callSites = new Map<ASTNode, ExecutionSite>();
  const declaratorSites = new Map<string, { readonly contextId: string; readonly end: SourcePoint }>();
  const scopeFrames = new Map<string, ScopeFrame>();

  const bindingFrameAt = (name: string, scope: ScopeFrame): ScopeFrame => {
    for (let current: ScopeFrame | undefined = scope; current !== undefined; current = current.parent) {
      if ((byScopeAndName.get(lexicalBindingKey(current.id, name)) ?? []).length > 0 || current.selfName === name) return current;
    }
    return scope;
  };
  const bindingKeyAt = (name: string, scope: ScopeFrame): string => bindingWriteKey(bindingFrameAt(name, scope).id, name);
  // RT-L2: a declarator runs whenever its binding's scope is entered when no branch, loop, `try`, `switch` case or label
  // lies between that scope and the declarator: every read in the scope then sees the value or comes before the
  // declarator (a `let`/`const` read there throws). `if (…) { var x = make(); }` may leave `x` undefined after the block;
  // `if (…) { const x = make(); x.run(); }` cannot.
  const runsWithScope = (frame: ScopeFrame, guard: WriteWalk["guard"]): boolean => {
    if (guard === undefined) return true;
    for (let current = frame.parent; current !== undefined; current = current.parent) if (current.id === guard.scope.id) return true;
    return false;
  };
  // RT-L2: a guarded declarator's value still counts when every use of the binding comes after it, in the same function
  // and inside the branch it sits in (`if (…) { var obj = new Map(); obj.set(k, v); }`): the declarator ran first.
  const guardedValues: Array<{ readonly key: string; readonly name: string; readonly id: ASTNode; readonly init: ASTNode; readonly region: ASTNode; readonly contextId: string; readonly end: SourcePoint }> = [];
  const uses = new Map<string, Array<{ readonly node: ASTNode; readonly scope: ScopeFrame; readonly contextId: string; readonly start: SourcePoint }>>();
  const unscopedBindings = collectUnscopedBindings(root, bindingKeyAt);
  const blockFunctionVars = collectBlockFunctionVars(root, bindingFrameAt);
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
  // `computed` marks a member or class-field key that is not static (`o[key] = …`), which B1c assumes not to produce
  // a method's name; every other unknown write is reflective (RT-M5).
  const writeProperty = (name: string | undefined, computed = false): void => {
    // `__proto__` swaps the prototype, so it may change every inherited method.
    if (name === undefined || name === "__proto__") {
      unknownPropertyWrites = true;
      if (name === "__proto__" || !computed) { unknownReflectiveWrites = true; reflectiveCount += 1; }
      return;
    }
    propertyWrites.set(name, (propertyWrites.get(name) ?? 0) + 1);
  };
  const writeObjectKeys = (source: ASTNode | undefined): void => {
    if (source?.type !== "ObjectExpression") {
      unknownPropertyWrites = true;
      unknownReflectiveWrites = true;
      reflectiveCount += 1;
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
        writeProperty(name, true);
        const object = target.children.find((child) => child.role === "object");
        if (name === "__proto__" && object?.type === "Identifier") { const swapped = identifier(object); if (swapped !== undefined) protoSwapTargets.add(bindingKeyAt(swapped, walk.scope)); }
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
    const inner: WriteWalk = {
      scope, contextId, loopIds,
      unconditional: opensContext || (walk.unconditional && !loopStatements.has(node.type)),
      guard: opensContext ? undefined : walk.guard,
    };
    if (node.type === "Identifier" && node.location !== undefined && !isNonReferenceName(node, parent)) {
      const name = identifier(node);
      const list = name === undefined ? undefined : uses.get(name);
      const use = { node, scope, contextId: walk.contextId, start: node.location.start };
      if (list !== undefined) list.push(use);
      else if (name !== undefined) uses.set(name, [use]);
    }

    if (node.type === "CallExpression" || node.type === "OptionalCallExpression" || node.type === "NewExpression") {
      if (node.location !== undefined) callSites.set(node, { contextId: walk.contextId, loopIds: walk.loopIds, start: node.location.start });
    }
    if (node.type === "VariableDeclarator" && node.location !== undefined) {
      const anchor = declarationAnchor(node.location);
      if (anchor !== undefined) declaratorSites.set(anchor, { contextId: walk.contextId, end: node.location.end });
    }
    if (node.type === "CallExpression" || node.type === "OptionalCallExpression") {
      const callee = node.children.find((child) => child.role === "callee");
      const args = node.children.filter((child) => child.role === "arguments");
      const writer = callee === undefined ? undefined : reflectiveWriterName(callee);
      const countBefore = reflectiveCount;
      if (writer !== undefined && args.some((arg) => arg.type === "SpreadElement")) {
        unknownPropertyWrites = true;
        unknownReflectiveWrites = true;
        reflectiveCount += 1;
      } else if (writer === "Object.assign") {
        // Filling a fresh object cannot replace a method of an existing one.
        if (!isFreshObject(args[0])) for (const source of args.slice(1)) writeObjectKeys(source);
      } else if (writer === "Object.defineProperties") {
        writeObjectKeys(args[1]);
      } else if (writer === "Object.setPrototypeOf" || writer === "Reflect.setPrototypeOf") {
        unknownPropertyWrites = true;
        unknownReflectiveWrites = true;
        reflectiveCount += 1;
      } else if (writer !== undefined) {
        writeProperty(staticPropertyKey(args[1]));
      }
      const property = callee?.type === "MemberExpression" || callee?.type === "OptionalMemberExpression" ? memberPropertyName(callee) : undefined;
      if (property === "__defineGetter__" || property === "__defineSetter__") writeProperty(staticPropertyKey(args[0]));
      // RT-M5: a call through a plain alias of a reflective writer (`const assign = Object.assign; assign(out, src)`) is
      // an unknown reflective write on its first argument.
      const aliasedWriter = callee?.type === "Identifier" && identifier(callee) !== undefined && writerAliases.has(bindingKeyAt(identifier(callee)!, walk.scope));
      if (aliasedWriter) { unknownReflectiveWrites = true; reflectiveCount += 1; }
      // RT-M5: the binding an unknown reflective write targets by name (`Object.assign(out, src)`, `out.__defineGetter__(k, …)`).
      if (reflectiveCount > countBefore) {
        const target = writer !== undefined || aliasedWriter ? args[0] : callee?.children.find((child) => child.role === "object");
        const targetName = target?.type === "Identifier" ? identifier(target) : undefined;
        if (targetName !== undefined) reflectiveTargets.add(bindingKeyAt(targetName, walk.scope));
      }
    }
    // Object/Reflect writers reached any other way (aliased, passed on, `.call`) are untracked writes.
    if (escapesReflectiveWriters(node, parent)) unknownPropertyWrites = unknownReflectiveWrites = escapedReflectiveWriters = true;
    // RT-M5: names declared as a plain alias of a reflective writer: `const assign = Object.assign`, `const { assign } = Object`.
    if (node.type === "VariableDeclarator") {
      const id = node.children.find((child) => child.role === "id");
      const init = node.children.find((child) => child.role === "init");
      if (id?.type === "Identifier" && init !== undefined && reflectiveWriterName(init) !== undefined && identifier(id) !== undefined) writerAliases.add(bindingKeyAt(identifier(id)!, walk.scope));
      const namespace = init?.type === "Identifier" ? identifier(init) : undefined;
      if (id?.type === "ObjectPattern" && namespace !== undefined && reflectiveNamespaces.has(namespace)) {
        for (const property of id.children) {
          const key = property.type === "ObjectProperty" ? propertyKeyName(property) : undefined;
          const value = property.type === "ObjectProperty" ? property.children.find((child) => child.role === "value") : undefined;
          const local = value?.type === "Identifier" ? identifier(value) : value?.type === "AssignmentPattern" ? identifier(value.children.find((child) => child.role === "left")) : undefined;
          if (key !== undefined && local !== undefined && reflectiveWriters.has(`${namespace}.${key}`)) writerAliases.add(bindingKeyAt(local, walk.scope));
        }
      }
    }
    // RT-M5: a plain alias (`const a = out`, `a = out`) reaches the same object.
    const aliasPair = node.type === "VariableDeclarator" ? [node.children.find((child) => child.role === "id"), node.children.find((child) => child.role === "init")]
      : node.type === "AssignmentExpression" && node.attributes.operator === "=" ? [node.children.find((child) => child.role === "left"), node.children.find((child) => child.role === "right")] : undefined;
    if (aliasPair !== undefined && aliasPair[0]?.type === "Identifier" && aliasPair[1]?.type === "Identifier") {
      const aliasName = identifier(aliasPair[0]);
      const sourceName = identifier(aliasPair[1]);
      if (aliasName !== undefined && sourceName !== undefined) {
        const aliasKey = bindingKeyAt(aliasName, walk.scope);
        aliasSources.set(aliasKey, new Set([...(aliasSources.get(aliasKey) ?? []), bindingKeyAt(sourceName, walk.scope)]));
      }
    }
    if (node.type === "Identifier" && usedAsValue(node, parent)) {
      const used = identifier(node);
      const key = used === undefined ? undefined : bindingKeyAt(used, walk.scope);
      if (key !== undefined) escapedNames.add(key);
      // A binding whose real scope is not modelled may be any outer one of that name (as for writes).
      if (used !== undefined && key !== undefined && unscopedBindings.has(key)) for (let current = walk.scope.parent; current !== undefined; current = current.parent) escapedNames.add(bindingWriteKey(current.id, used));
    }
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
      writeProperty(classElementName(node), true);
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
        if (id?.type === "Identifier" && init !== undefined) {
          const frame = bindingFrameAt(name, walk.scope);
          const key = bindingWriteKey(frame.id, name);
          if (runsWithScope(frame, walk.guard)) declaredValues.set(key, init);
          else if (walk.guard !== undefined && node.location !== undefined) guardedValues.push({ key, name, id, init, region: walk.guard.node, contextId: walk.contextId, end: node.location.end });
        }
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
      const conditional = isConditionalChild(node, child);
      // A loop's `init` (and a for…in/of's iterated value) runs whenever the loop is reached; its other parts may not.
      const guarded = conditional || (loopStatements.has(node.type) && child.role !== "init" && child.role !== "right");
      visit(child, { ...inner, unconditional: inner.unconditional && !conditional, guard: guarded ? { scope, node: child } : inner.guard }, node);
    }
  };
  visit(root, { scope: createScope(MODULE_SCOPE_ID), contextId: MODULE_SCOPE_ID, loopIds: [], unconditional: true, guard: undefined }, undefined);
  for (const value of guardedValues) {
    const region = value.region.location;
    const followsInRegion = (start: SourcePoint): boolean => region !== undefined && comparePoints(value.end, start) <= 0 && comparePoints(start, region.end) <= 0;
    const usedAfter = (uses.get(value.name) ?? []).every((use) => use.node === value.id || bindingKeyAt(value.name, use.scope) !== value.key
      || (use.contextId === value.contextId && followsInRegion(use.start)));
    if (usedAfter) declaredValues.set(value.key, value.init);
  }
  return immutable({ reboundBindings, propertyWrites, unknownPropertyWrites, unknownReflectiveWrites, protoSwapTargets, escapedNames, reflectiveTargets, aliasSources, escapedReflectiveWriters, propertyWriteSites, declaredValues, writeSites, declaringContext, callSites, declaratorSites, scopeFrames, unscopedBindings, blockFunctionVars });
}

export const classFieldTypes = new Set(["ClassProperty", "ClassPrivateProperty", "PropertyDefinition", "ClassAccessorProperty"]);

/**
 * Whether an identifier reads its binding as a value that can be handed on (RT-M5): any reference except the object of
 * a member access (`out.push`, `out[i]`), a write target, a name that is not a reference at all (a declaration, a
 * non-computed key or member name, a label, a type), and uses that only read the value without passing the object on:
 * iteration (`for (x of out)`, `...out`), a test (`if (out)`, `out ? a : b`, `switch (out)`), a unary or comparison
 * operator (`!out`, `out === x`), a computed key (`o[out]`) or a statement of its own. `out instanceof C` counts, since
 * a class may define `Symbol.hasInstance`; a template literal counts, since a tag receives its values.
 */
function usedAsValue(node: ASTNode, parent: ASTNode | undefined): boolean {
  if (parent === undefined) return false;
  const role = node.role;
  switch (parent.type) {
    case "MemberExpression":
    case "OptionalMemberExpression":
      return false;
    case "AssignmentExpression":
      return role !== "left";
    case "BinaryExpression":
      return parent.attributes.operator === "instanceof" && role === "left";
    case "IfStatement":
    case "WhileStatement":
    case "DoWhileStatement":
    case "ForStatement":
    case "ConditionalExpression":
    case "SwitchCase":
      return role !== "test";
    case "SwitchStatement":
      return role !== "discriminant";
    case "ForInStatement":
    case "ForOfStatement":
    case "SpreadElement":
    case "UnaryExpression":
    case "ExpressionStatement":
    case "UpdateExpression":
    case "ArrayPattern":
    case "RestElement":
    case "LabeledStatement":
    case "BreakStatement":
    case "ContinueStatement":
    case "ImportSpecifier":
    case "ImportDefaultSpecifier":
    case "ImportNamespaceSpecifier":
    case "TSTypeReference":
    case "TSQualifiedName":
    case "TSTypeQuery":
    case "TSExpressionWithTypeArguments":
      return false;
    case "AssignmentPattern":
      return role !== "left";
    case "VariableDeclarator":
    case "CatchClause":
      return role !== "id" && role !== "param";
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
    case "ClassDeclaration":
    case "ClassExpression":
      return role !== "id" && role !== "param" && role !== "params";
    case "ObjectProperty":
    case "ObjectMethod":
    case "ClassMethod":
    case "ClassPrivateMethod":
    case "ClassProperty":
    case "ClassPrivateProperty":
    case "ClassAccessorProperty":
      return role !== "key" || parent.attributes.computed === true;
    default:
      return true;
  }
}

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
 * is treated as sloppy, never the reverse. That var lives in the enclosing function: a binding of the name declared
 * outside it (a module function `run` beside `function g() { if (…) { function run() {} } }`) is not touched.
 */
function collectBlockFunctionVars(root: ASTNode, bindingFrameAt: (name: string, scope: ScopeFrame) => ScopeFrame): ReadonlySet<string> {
  // The frame whose binding of `name` a frame between the block and its function sees, if that binding is declared
  // inside the function; otherwise Annex B's own var in the function.
  const affectedFrame = (name: string, frame: ScopeFrame, functionFrame: ScopeFrame): ScopeFrame => {
    const declared = bindingFrameAt(name, frame);
    for (let current: ScopeFrame | undefined = frame; current !== undefined; current = current.parent) {
      if (current.id === declared.id) return declared;
      if (current.id === functionFrame.id) break;
    }
    return functionFrame;
  };
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
          names.add(bindingWriteKey(affectedFrame(name, frame, functionFrame).id, name));
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
