import type { ASTNode, ASTResult } from "@parser/index";
import type { CodeSymbol, SymbolTable } from "@symbols/index";
import { canonicalizePath } from "@graph/index";

/**
 * Whole-repository facts that decide whether `this.m()` inside a class is proven to call that class's own `m`.
 *
 * A subclass may override `m`, and a method may run with another `this` when it is borrowed (read as a value:
 * `emitter.on("x", obj.run)`, `obj.run.call(other)`, `const { run } = obj`). Both can happen in any file, so each
 * file contributes its classes (what each extends and which member names it declares or assigns on `this`), the
 * property names it writes, and the property names it reads as values; the hierarchy is then linked once the import
 * graph tells which file an imported superclass comes from.
 *
 * A class that escapes its file (exported, or used as a value other than `new C()`, `extends C`, a type or a static
 * member) may be subclassed by code outside the analysed files, a library's users for instance (F-002), so its public
 * methods are open unless the hierarchy is built closed-world. So are the methods of every class it extends: an
 * outside subclass of an exported `Public extends Base` overrides `Base`'s methods too (XA-02). A class that neither
 * escapes nor has an escaping class below it can only be extended in the analysed files.
 *
 * Assumptions, as elsewhere in the call graph: other files do not write or read methods by computed key or reflection (`proto[name] = f`,
 * `Reflect.get(o, "run")`; the calling file's own such writes are checked there), and a class body is strict mode
 * (an unbound method call has no `this`, so it throws rather than reaching another object). In the class's own
 * file, a computed read as a value of `this`, the class, its `prototype` or a variable holding `new C()` borrows
 * any method of the class (XA-04); a computed read of any other object there is assumed not to reach an instance.
 */

/** What a class's `extends` denotes, as far as one file can tell. */
export type SuperclassRef =
  | { readonly kind: "class"; readonly id: string }
  | { readonly kind: "import"; readonly importId: string; readonly specifier: string }
  | { readonly kind: "external" }
  | { readonly kind: "unknown" };

export interface ClassFact {
  readonly id: string;
  readonly filePath: string;
  readonly superclass?: SuperclassRef;
  /** Names the class declares or assigns on `this`; `*` stands for a computed name. */
  readonly members: readonly string[];
  /** Whether code outside its file can reach the class itself (and so extend it). */
  readonly escapes: boolean;
  /**
   * Whether its file reads `this` (in its body), the class, its `prototype` or a variable holding `new C()` by a
   * computed key as a value (`const f = c[key]`), which may take any of its methods (XA-04).
   */
  readonly computedReads?: boolean;
}

export interface ClassHierarchyFile {
  readonly filePath: string;
  readonly classes: readonly ClassFact[];
  /** Property names the file writes (`x.m = …`), `*` for a computed one. */
  readonly writtenNames: readonly string[];
  /**
   * Property names the file writes by name on an object that may be another module's instance (XA-03): not `this`
   * (a class's own writes on `this` are its members) and not the file's own `exports` / `module.exports`.
   */
  readonly foreignWrittenNames: readonly string[];
  /** Property names the file reads as a value rather than calling them. */
  readonly borrowedNames: readonly string[];
}

const MODULE_SCOPE = "scope:module";
const COMPUTED = "*";

/** One file's contribution, collected while the file's AST and symbol table are at hand. */
export function collectClassHierarchyFacts(ast: ASTResult, table: SymbolTable | undefined): ClassHierarchyFile {
  const filePath = canonicalizePath(ast.metadata.sourcePath);
  const symbols = table?.symbols ?? [];
  const classByStart = new Map<string, CodeSymbol>();
  const byName = new Map<string, CodeSymbol[]>();
  for (const symbol of symbols) {
    if (symbol.kind === "class" && symbol.location !== undefined) {
      const key = `${symbol.location.start.line}:${symbol.location.start.column}`;
      if (!classByStart.has(key)) classByStart.set(key, symbol);
    }
    byName.set(symbol.name, [...(byName.get(symbol.name) ?? []), symbol]);
  }
  const classes: Array<Omit<ClassFact, "escapes"> & { readonly name: string | undefined; readonly expression: boolean; readonly exported: boolean }> = [];
  const written = new Set<string>();
  const foreignWritten = new Set<string>();
  const borrowed = new Set<string>();
  const valueUses = new Map<string, number>();
  // XA-04: classes whose `this` is read by a computed key, names whose value is read so, and the variables that
  // hold `new C()` (variable -> class names).
  const computedThisClasses = new Set<string>();
  const computedObjectNames = new Set<string>();
  const instanceClasses = new Map<string, Set<string>>();
  const noteInstance = (variable: ASTNode | undefined, value: ASTNode | undefined): void => {
    const variableName = variable?.type === "Identifier" ? nameOf(variable) : undefined;
    const className = value?.type === "NewExpression" ? newCalleeName(value) : undefined;
    if (variableName === undefined || className === undefined) return;
    instanceClasses.set(variableName, new Set([...(instanceClasses.get(variableName) ?? []), className]));
  };
  const noteComputedRead = (object: ASTNode | undefined, currentClass: string | undefined): void => {
    if (object === undefined) return;
    if (object.type === "ThisExpression") {
      if (currentClass !== undefined) computedThisClasses.add(currentClass);
      return;
    }
    if (object.type === "NewExpression") {
      const className = newCalleeName(object);
      if (className !== undefined) computedObjectNames.add(className);
      return;
    }
    if (object.type === "MemberExpression" && object.attributes.computed !== true) {
      const base = object.children.find((child) => child.role === "object");
      const property = object.children.find((child) => child.role === "property");
      if (base?.type === "Identifier" && property !== undefined && nameOf(property) === "prototype") {
        const name = nameOf(base);
        if (name !== undefined) computedObjectNames.add(name);
      }
      return;
    }
    if (object.type === "Identifier") {
      const name = nameOf(object);
      if (name !== undefined) computedObjectNames.add(name);
    }
  };

  // C3: top-level writes on an alias of this file's own exports object are writes on that object.
  const ownExports = ownExportsOf(ast.root);
  const exportAliases = ownExports.aliases;
  const topLevelAssignments = new Set<ASTNode>();
  for (const statement of ast.root.children) {
    const expression = statement.type === "ExpressionStatement" ? statement.children.find((child) => child.role === "expression") : undefined;
    if (expression?.type === "AssignmentExpression") topLevelAssignments.add(expression);
  }
  const isOwnAlias = (object: ASTNode | undefined, assignment: ASTNode | undefined): boolean =>
    object?.type === "Identifier" && assignment !== undefined && topLevelAssignments.has(assignment) && exportAliases.has(nameOf(object) ?? "");
  // RT-M1: each member expression the file writes, and the node that writes it (see writtenTargets).
  const writers = new Map<ASTNode, ASTNode>();

  const visit = (node: ASTNode, parent: ASTNode | undefined, currentClass: string | undefined): void => {
    let classInside = currentClass;
    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      const symbol = node.location === undefined ? undefined : classByStart.get(`${node.location.start.line}:${node.location.start.column}`);
      if (symbol !== undefined) classInside = symbol.id;
      if (symbol !== undefined) {
        const superNode = node.children.find((child) => child.role === "superClass");
        const id = node.children.find((child) => child.role === "id");
        classes.push({
          id: symbol.id,
          filePath,
          ...(superNode === undefined ? {} : { superclass: superclassRef(superNode, byName) }),
          members: [...classMembers(node)].sort(),
          name: id === undefined ? undefined : nameOf(id),
          expression: node.type === "ClassExpression",
          exported: symbol.exported,
        });
      }
    }
    for (const target of writtenTargets(node)) if (target.type !== "Identifier") writers.set(target, node);
    if (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") {
      const name = memberPropertyName(node);
      const role = node.role;
      const called = (parent?.type === "CallExpression" || parent?.type === "OptionalCallExpression" || parent?.type === "NewExpression") && role === "callee";
      const tagged = parent?.type === "TaggedTemplateExpression" && role === "tag";
      const writer = writers.get(node);
      if (writer !== undefined) {
        written.add(name ?? COMPUTED);
        const object = node.children.find((child) => child.role === "object");
        if (name !== undefined && !isOwnObject(object, ownExports) && !isOwnAlias(object, writer)) foreignWritten.add(name);
      }
      else if (!called && !tagged && !(parent?.type === "UnaryExpression" && parent.attributes.operator === "delete")) {
        if (name !== undefined) borrowed.add(name);
        else if (node.attributes.computed === true) noteComputedRead(node.children.find((child) => child.role === "object"), currentClass);
      }
    }
    if (node.type === "ObjectPattern") {
      // Destructuring reads each named property as a value: `const { run } = obj`.
      for (const property of node.children) {
        if (property.type !== "ObjectProperty") continue;
        const name = keyName(property);
        if (name !== undefined) borrowed.add(name);
        else if (property.attributes.computed === true && parent?.type === "VariableDeclarator" && node.role === "id") {
          noteComputedRead(parent.children.find((child) => child.role === "init"), currentClass);
        }
      }
    }
    if (node.type === "VariableDeclarator") noteInstance(node.children.find((child) => child.role === "id"), node.children.find((child) => child.role === "init"));
    if (node.type === "AssignmentExpression") noteInstance(node.children.find((child) => child.role === "left"), node.children.find((child) => child.role === "right"));
    if (node.type === "Identifier" && isValueUse(node, parent)) {
      const name = nameOf(node);
      if (name !== undefined) valueUses.set(name, (valueUses.get(name) ?? 0) + 1);
    }
    for (const child of node.children) visit(child, node, classInside);
  };
  visit(ast.root, undefined, undefined);
  const computedClassNames = new Set<string>();
  for (const name of computedObjectNames) {
    computedClassNames.add(name);
    for (const className of instanceClasses.get(name) ?? []) computedClassNames.add(className);
  }
  return {
    filePath,
    classes: classes.map(({ name, expression, exported, ...fact }) => ({
      ...fact,
      ...(computedThisClasses.has(fact.id) || (name !== undefined && computedClassNames.has(name)) ? { computedReads: true } : {}),
      escapes: exported || expression || name === undefined || (valueUses.get(name) ?? 0) > 0,
    })),
    writtenNames: [...written].sort(),
    foreignWrittenNames: [...foreignWritten].sort(),
    borrowedNames: [...borrowed].sort(),
  };
}

function isModuleExportsNode(node: ASTNode | undefined): boolean {
  if (node?.type !== "MemberExpression" || node.attributes.computed === true) return false;
  const base = node.children.find((child) => child.role === "object");
  const property = node.children.find((child) => child.role === "property");
  return base?.type === "Identifier" && nameOf(base) === "module" && property !== undefined && nameOf(property) === "exports";
}

/** A value that is a new object made here, never another module's: a literal, a function or class, `Object.create(…)`. */
function isFreshValue(node: ASTNode | undefined): boolean {
  if (node === undefined) return false;
  if (["ObjectExpression", "FunctionExpression", "ArrowFunctionExpression", "ClassExpression"].includes(node.type)) return true;
  if (node.type !== "CallExpression") return false;
  const callee = node.children.find((child) => child.role === "callee");
  const base = callee?.type === "MemberExpression" ? callee.children.find((child) => child.role === "object") : undefined;
  const property = callee?.type === "MemberExpression" ? callee.children.find((child) => child.role === "property") : undefined;
  return base?.type === "Identifier" && nameOf(base) === "Object" && property !== undefined && nameOf(property) === "create";
}

/**
 * Which names of a file hold its own exports object, an object made in that file, so that a write on them cannot
 * replace a method of another module's value (C3, RT-M3).
 */
interface OwnExports {
  /** Top-level aliases of the exports object (see ownExportsOf). */
  readonly aliases: ReadonlySet<string>;
  /** Whether `exports` is the CommonJS wrapper's binding, never declared in the file and only assigned values made here. */
  readonly exportsOwn: boolean;
  /** Whether `module` is the wrapper's binding, never declared in the file, and `module.exports` is only assigned values made here. */
  readonly moduleExportsOwn: boolean;
}

/**
 * Phase C3: names that hold this file's own exports object, declared at the top of the file and never reassigned:
 * `var app = exports = module.exports = {}`, `var proto = module.exports = function …`, `const api = module.exports`, or
 * `var res = Object.create(…); … module.exports = res`. The value must be made here (isFreshValue), so the alias can
 * never be another module's object.
 *
 * RT-M3: `exports` and `module.exports` themselves are own only while every value assigned to them is made here: a
 * fresh value, a top-level function or class declared once and never reassigned (`exports = module.exports =
 * createApplication`), or a top-level name holding a fresh value. `module.exports = require("./x")` or
 * `exports = other` makes them another module's object; a parameter or variable named `exports` or `module` (in any
 * scope, which only over-approximates) may hold anything.
 */
function ownExportsOf(root: ASTNode): OwnExports {
  const reassigned = new Set<string>();
  // How many declarations bind each name, in any scope: a parameter, variable, function, class, catch or import.
  const declarations = new Map<string, number>();
  const declare = (name: string | undefined): void => {
    if (name !== undefined) declarations.set(name, (declarations.get(name) ?? 0) + 1);
  };
  // The values stored in `exports` and in `module.exports`; undefined stands for one not known (`exports ||= x`, `[exports] = …`).
  const exportsValues: Array<ASTNode | undefined> = [];
  const moduleExportsValues: Array<ASTNode | undefined> = [];
  const assignTargets = (target: ASTNode | undefined): void => {
    for (const name of boundNames(target)) {
      reassigned.add(name);
      if (name === "exports") exportsValues.push(undefined);
    }
  };
  const walk = (node: ASTNode): void => {
    if (node.type === "AssignmentExpression") {
      const left = node.children.find((child) => child.role === "left");
      let value = node.attributes.operator === "=" ? node.children.find((child) => child.role === "right") : undefined;
      while (value?.type === "AssignmentExpression" && value.attributes.operator === "=") value = value.children.find((child) => child.role === "right");
      if (left?.type === "Identifier" && nameOf(left) === "exports") {
        reassigned.add("exports");
        exportsValues.push(value);
      } else {
        assignTargets(left);
      }
      if (isModuleExportsNode(left)) moduleExportsValues.push(value);
    }
    if (node.type === "ForInStatement" || node.type === "ForOfStatement") {
      const left = node.children.find((child) => child.role === "left");
      if (left?.type !== "VariableDeclaration") assignTargets(left);
    }
    if (node.type === "UpdateExpression") assignTargets(node.children.find((child) => child.role === "argument"));
    if (node.type === "VariableDeclarator") for (const name of boundNames(node.children.find((child) => child.role === "id"))) declare(name);
    if (node.type === "CatchClause") for (const name of boundNames(node.children.find((child) => child.role === "param"))) declare(name);
    if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ObjectMethod", "ClassMethod", "ClassPrivateMethod"].includes(node.type)) {
      for (const param of node.children.filter((child) => child.role === "param" || child.role === "params")) for (const name of boundNames(param)) declare(name);
    }
    if (["FunctionDeclaration", "FunctionExpression", "ClassDeclaration", "ClassExpression"].includes(node.type)) {
      const id = node.children.find((child) => child.role === "id");
      if (id !== undefined) declare(nameOf(id));
    }
    if (["ImportSpecifier", "ImportDefaultSpecifier", "ImportNamespaceSpecifier"].includes(node.type)) {
      const local = node.children.find((child) => child.role === "local");
      if (local !== undefined) declare(nameOf(local));
    }
    for (const child of node.children) walk(child);
  };
  walk(root);
  // Top-level names whose one declaration makes their value here: a function or class declaration, or a single
  // declarator with a fresh value (`var res = Object.create(…)`).
  const ownNames = new Set<string>();
  for (const statement of root.children) {
    if (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") {
      const id = statement.children.find((child) => child.role === "id");
      const name = id === undefined ? undefined : nameOf(id);
      if (name !== undefined) ownNames.add(name);
    }
    const declarators = statement.type === "VariableDeclaration" ? statement.children.filter((child) => child.type === "VariableDeclarator") : [];
    const id = declarators.length === 1 ? declarators[0]!.children.find((child) => child.role === "id") : undefined;
    const name = id?.type === "Identifier" ? nameOf(id) : undefined;
    if (name !== undefined && isFreshValue(declarators[0]!.children.find((child) => child.role === "init"))) ownNames.add(name);
  }
  const ownValue = (value: ASTNode | undefined): boolean => {
    if (isFreshValue(value)) return true;
    const name = value?.type === "Identifier" ? nameOf(value) : undefined;
    return name !== undefined && ownNames.has(name) && declarations.get(name) === 1 && !reassigned.has(name);
  };
  const exportsOwn = !declarations.has("exports") && exportsValues.every(ownValue);
  const moduleExportsOwn = !declarations.has("module") && moduleExportsValues.every(ownValue);

  const aliases = new Set<string>();
  const freshDeclared = new Set<string>();
  for (const statement of root.children) {
    if (statement.type === "VariableDeclaration") {
      const declarators = statement.children.filter((child) => child.type === "VariableDeclarator");
      if (declarators.length !== 1) continue;
      const id = declarators[0]!.children.find((child) => child.role === "id");
      const name = id?.type === "Identifier" ? nameOf(id) : undefined;
      let value = declarators[0]!.children.find((child) => child.role === "init");
      if (name === undefined || reassigned.has(name)) continue;
      // A plain read of `module.exports` holds another module's object once it may be one (`module.exports = require("./x")`).
      if (isModuleExportsNode(value)) { if (moduleExportsOwn) aliases.add(name); continue; }
      let toExports = false;
      while (value?.type === "AssignmentExpression" && value.attributes.operator === "=") {
        const left = value.children.find((child) => child.role === "left");
        if (isModuleExportsNode(left)) toExports = true;
        else if (!(left?.type === "Identifier" && nameOf(left) === "exports")) { value = undefined; break; }
        value = value.children.find((child) => child.role === "right");
      }
      if (isFreshValue(value)) (toExports ? aliases : freshDeclared).add(name);
    }
    const expression = statement.type === "ExpressionStatement" ? statement.children.find((child) => child.role === "expression") : undefined;
    if (expression?.type === "AssignmentExpression" && isModuleExportsNode(expression.children.find((child) => child.role === "left"))) {
      const right = expression.children.find((child) => child.role === "right");
      const name = right?.type === "Identifier" ? nameOf(right) : undefined;
      if (name !== undefined && freshDeclared.has(name)) aliases.add(name);
    }
  }
  return { aliases, exportsOwn, moduleExportsOwn };
}

/** Names a binding pattern or assignment target binds (`a`, `[a, { b }]`, `c = 1`, `...d`); member targets bind none. */
function boundNames(target: ASTNode | undefined): string[] {
  if (target === undefined) return [];
  switch (target.type) {
    case "Identifier": {
      const name = nameOf(target);
      return name === undefined ? [] : [name];
    }
    case "AssignmentPattern":
      return boundNames(target.children.find((child) => child.role === "left"));
    case "RestElement":
      return boundNames(target.children.find((child) => child.role === "argument"));
    case "ObjectPattern":
      return target.children.flatMap((property) => property.type === "RestElement" ? boundNames(property)
        : property.type === "ObjectProperty" ? boundNames(property.children.find((child) => child.role === "value") ?? property.children.find((child) => child.role === "key")) : []);
    case "ArrayPattern":
      return target.children.flatMap((element) => boundNames(element));
    case "TSParameterProperty":
      return boundNames(target.children.find((child) => child.role === "parameter"));
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
    case "TSTypeAssertion":
    case "ParenthesizedExpression":
      return boundNames(target.children.find((child) => child.role === "expression"));
    default:
      return [];
  }
}

/**
 * `this`, or `exports` or `module.exports` while they hold this file's own exports object (RT-M3): an object a write in
 * this file cannot make another module's instance.
 */
function isOwnObject(object: ASTNode | undefined, own: OwnExports): boolean {
  if (object === undefined) return false;
  if (object.type === "ThisExpression") return true;
  if (object.type === "Identifier") return nameOf(object) === "exports" && own.exportsOwn;
  if (object.type !== "MemberExpression" || object.attributes.computed === true) return false;
  const base = object.children.find((child) => child.role === "object");
  const property = object.children.find((child) => child.role === "property");
  return base?.type === "Identifier" && nameOf(base) === "module" && property !== undefined && nameOf(property) === "exports" && own.moduleExportsOwn;
}

/**
 * The places a node stores a value, each an Identifier or a member expression (RT-M1): the target of an assignment of
 * any operator (`o.m = …`, `o.m ||= …`), every target of a destructuring assignment (`[o.m] = …`, `({ k: o.m } = …)`,
 * defaults and rest included), the head of a `for…in` or `for…of` that declares nothing (`for (o.m of fns)`), and the
 * operand of `++` or `--`. Parentheses and TypeScript wrappers are looked through (`(o.m as any) = …`). A declaration
 * (`const { m } = o`) stores into its new bindings only and is not listed.
 */
export function writtenTargets(node: ASTNode): ASTNode[] {
  if (node.type === "AssignmentExpression") return targetLeaves(node.children.find((child) => child.role === "left"));
  if (node.type === "UpdateExpression") return targetLeaves(node.children.find((child) => child.role === "argument"));
  if (node.type === "ForInStatement" || node.type === "ForOfStatement") {
    const left = node.children.find((child) => child.role === "left");
    return left?.type === "VariableDeclaration" ? [] : targetLeaves(left);
  }
  return [];
}

function targetLeaves(target: ASTNode | undefined): ASTNode[] {
  switch (target?.type) {
    case "Identifier":
    case "MemberExpression":
    case "OptionalMemberExpression":
      return [target];
    case "AssignmentPattern":
      return targetLeaves(target.children.find((child) => child.role === "left"));
    case "RestElement":
      return targetLeaves(target.children.find((child) => child.role === "argument"));
    case "ObjectPattern":
      return target.children.flatMap((property) => property.type === "RestElement" ? targetLeaves(property)
        : property.type === "ObjectProperty" ? targetLeaves(property.children.find((child) => child.role === "value") ?? property.children.find((child) => child.role === "key")) : []);
    case "ArrayPattern":
      return target.children.flatMap((element) => targetLeaves(element));
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
    case "TSTypeAssertion":
    case "ParenthesizedExpression":
      return targetLeaves(target.children.find((child) => child.role === "expression"));
    default:
      return [];
  }
}

/**
 * Whether an identifier reads a binding as a value that could reach a class: not a declaration's own name, not
 * `new C()` or `extends C`, not a type position, and not the object of a static member (`C.create()`) other
 * than `C.prototype`. Any binding of the name counts, which only over-approximates.
 */
function isValueUse(node: ASTNode, parent: ASTNode | undefined): boolean {
  if (parent === undefined) return true;
  const role = node.role;
  if ((parent.type === "ClassDeclaration" || parent.type === "ClassExpression") && (role === "id" || role === "superClass")) return false;
  if (parent.type === "NewExpression" && role === "callee") return false;
  if (["TSTypeReference", "TSQualifiedName", "TSTypeQuery", "TSExpressionWithTypeArguments", "TSClassImplements", "TSInterfaceHeritage"].includes(parent.type)) return false;
  if ((parent.type === "MemberExpression" || parent.type === "OptionalMemberExpression") && role === "property" && parent.attributes.computed !== true) return false;
  if ((parent.type === "MemberExpression" || parent.type === "OptionalMemberExpression") && role === "object") {
    const property = parent.children.find((child) => child.role === "property");
    return parent.attributes.computed === true || property === undefined || nameOf(property) === "prototype";
  }
  if (["ClassMethod", "ClassPrivateMethod", "ObjectMethod", "ObjectProperty", "ClassProperty", "ClassPrivateProperty", "ClassAccessorProperty"].includes(parent.type) && role === "key" && parent.attributes.computed !== true) return false;
  if (["FunctionDeclaration", "FunctionExpression", "VariableDeclarator", "ImportSpecifier", "ImportDefaultSpecifier", "ImportNamespaceSpecifier", "LabeledStatement", "BreakStatement", "ContinueStatement"].includes(parent.type) && (role === "id" || role === "local" || role === "label")) return false;
  return true;
}

/** Names a class body declares, and names its code assigns on `this` (a constructor's `this.m = …`). */
function classMembers(classNode: ASTNode): Set<string> {
  const members = new Set<string>();
  const body = classNode.children.find((child) => child.type === "ClassBody");
  for (const element of body?.children ?? []) {
    if (element.type === "StaticBlock") continue;
    const name = keyName(element);
    if (name === "constructor") continue;
    members.add(name ?? COMPUTED);
  }
  const visit = (node: ASTNode): void => {
    if (node !== classNode && (node.type === "ClassDeclaration" || node.type === "ClassExpression")) return;
    for (const target of writtenTargets(node)) {
      if (target.type !== "Identifier" && target.children.find((child) => child.role === "object")?.type === "ThisExpression") members.add(memberPropertyName(target) ?? COMPUTED);
    }
    for (const child of node.children) visit(child);
  };
  if (body !== undefined) visit(body);
  return members;
}

/**
 * What `extends E` denotes. A module-level class or import (a `require` binding's variable included) is followed;
 * a name not declared in the file is a global (`Error`), outside the repository; a member of an import is that
 * import's module. Anything else, or a name some inner scope also declares, may be any class: unknown.
 */
function superclassRef(node: ASTNode, byName: ReadonlyMap<string, readonly CodeSymbol[]>): SuperclassRef {
  const rootName = (expression: ASTNode): string | undefined => {
    if (expression.type === "Identifier") return nameOf(expression);
    if (expression.type === "MemberExpression" && expression.attributes.computed !== true) {
      const object = expression.children.find((child) => child.role === "object");
      return object === undefined ? undefined : rootName(object);
    }
    return undefined;
  };
  const name = rootName(node);
  if (name === undefined) return { kind: "unknown" };
  const declared = byName.get(name) ?? [];
  if (declared.length === 0) return { kind: "external" };
  if (declared.some((symbol) => symbol.scopeId !== MODULE_SCOPE)) return { kind: "unknown" };
  const imports = declared.filter((symbol) => symbol.kind === "import");
  const classes = declared.filter((symbol) => symbol.kind === "class");
  if (node.type === "Identifier" && classes.length === 1 && imports.length === 0 && declared.every((symbol) => symbol.kind === "class" || symbol.kind === "export")) {
    return { kind: "class", id: classes[0]!.id };
  }
  if (imports.length === 1 && classes.length === 0 && declared.every((symbol) => symbol.kind === "import" || symbol.kind === "variable" || symbol.kind === "export")) {
    const imported = imports[0]!;
    return { kind: "import", importId: imported.id, specifier: imported.moduleSpecifier ?? "" };
  }
  return { kind: "unknown" };
}

/** The class name a `new C(…)` constructs, when its callee is a plain name. */
function newCalleeName(node: ASTNode): string | undefined {
  const callee = node.children.find((child) => child.role === "callee");
  return callee?.type === "Identifier" ? nameOf(callee) : undefined;
}

function memberPropertyName(member: ASTNode): string | undefined {
  const property = member.children.find((child) => child.role === "property");
  if (member.attributes.computed === true) return property?.type === "StringLiteral" && typeof property.attributes.value === "string" ? property.attributes.value : undefined;
  return property === undefined ? undefined : nameOf(property);
}

function keyName(element: ASTNode): string | undefined {
  const key = element.children.find((child) => child.role === "key");
  if (key === undefined) return undefined;
  if (element.attributes.computed === true) return key.type === "StringLiteral" && typeof key.attributes.value === "string" ? key.attributes.value : undefined;
  if (key.type === "StringLiteral" && typeof key.attributes.value === "string") return key.attributes.value;
  if (key.type === "PrivateName") {
    const id = key.children.find((child) => child.role === "id");
    const inner = id === undefined ? undefined : nameOf(id);
    return inner === undefined ? undefined : `#${inner}`;
  }
  return nameOf(key);
}

function nameOf(node: ASTNode): string | undefined {
  return typeof node.attributes.name === "string" ? node.attributes.name : undefined;
}

/**
 * The linked hierarchy. A subclass whose `extends` names an import is attached to every class of the file that
 * import resolves to (which class it picked is not tracked, so this only over-approximates); an import that
 * resolves to no file is outside the repository when it names a package, unknown when it is a relative path.
 */
export class ClassHierarchy {
  private readonly classes = new Map<string, ClassFact>();
  private readonly childrenByClass = new Map<string, ClassFact[]>();
  private readonly childrenByFile = new Map<string, ClassFact[]>();
  private readonly writtenByFile = new Map<string, ReadonlySet<string>>();
  private readonly borrowed = new Set<string>();
  /** Members of classes with an unknown superclass, and of their subclasses: they may override any class's members. */
  private readonly unknownOverrides = new Set<string>();
  /**
   * The file that writes each property name on a foreign object (`obj.m = …`), or `true` when several do. Such a
   * write may replace `m` on an instance of any class, an exported singleton for instance (XA-03); the class's own
   * file is checked where the call is.
   */
  private readonly foreignWriters = new Map<string, string | true>();
  private readonly overrideCache = new Map<string, ReadonlySet<string>>();
  private readonly openCache = new Map<string, boolean>();

  /**
   * @param closedWorld - Treat the analysed files as the whole program, so a class that escapes its file is extended
   *   only by the subclasses found here. Off by default: a library's users may extend its exported classes (F-002).
   */
  public constructor(
    files: Iterable<ClassHierarchyFile>,
    importTargetFile: (importId: string) => string | undefined,
    private readonly closedWorld = false,
  ) {
    const unknownRoots: ClassFact[] = [];
    for (const file of files) {
      for (const name of file.borrowedNames) this.borrowed.add(name);
      for (const name of file.foreignWrittenNames) {
        const writer = this.foreignWriters.get(name);
        this.foreignWriters.set(name, writer === undefined || writer === file.filePath ? file.filePath : true);
      }
      if (file.classes.some((fact) => fact.superclass !== undefined)) this.writtenByFile.set(file.filePath, new Set(file.writtenNames));
      for (const fact of file.classes) {
        this.classes.set(fact.id, fact);
        const superclass = fact.superclass;
        if (superclass === undefined || superclass.kind === "external") continue;
        if (superclass.kind === "class") {
          this.childrenByClass.set(superclass.id, [...(this.childrenByClass.get(superclass.id) ?? []), fact]);
          continue;
        }
        if (superclass.kind === "import") {
          const target = importTargetFile(superclass.importId);
          if (target !== undefined) {
            const key = canonicalizePath(target);
            this.childrenByFile.set(key, [...(this.childrenByFile.get(key) ?? []), fact]);
            continue;
          }
          if (!/^\.{0,2}\//.test(superclass.specifier) && superclass.specifier !== "." && superclass.specifier !== "..") continue;
        }
        unknownRoots.push(fact);
      }
    }
    for (const root of unknownRoots) {
      for (const name of this.subtreeMembers(root.id, new Set())) this.unknownOverrides.add(name);
      for (const name of this.ownMembers(root)) this.unknownOverrides.add(name);
    }
  }

  /**
   * Whether a class that extends `classId`, directly or not, anywhere in the repository may define `name`, or
   * another file may write `name` on one of its instances.
   */
  public mayOverride(classId: string, name: string): boolean {
    if (!this.closedWorld && this.mayBeExtendedOutside(classId)) return true;
    const writer = this.foreignWriters.get(name);
    if (writer !== undefined && writer !== this.classes.get(classId)?.filePath) return true;
    if (this.unknownOverrides.has(name) || this.unknownOverrides.has(COMPUTED)) return true;
    let names = this.overrideCache.get(classId);
    if (names === undefined) {
      names = this.subtreeMembers(classId, new Set());
      this.overrideCache.set(classId, names);
    }
    return names.has(name) || names.has(COMPUTED);
  }

  /** Whether some file writes a property named `name` by name on an object other than `this` and its own exports. */
  public isWrittenByName(name: string): boolean {
    return this.foreignWriters.has(name);
  }

  /** isWrittenByName, leaving out the writes of `filePath` itself (its own writes are checked where it is analysed). */
  public isWrittenOutside(name: string, filePath: string): boolean {
    const writer = this.foreignWriters.get(name);
    return writer !== undefined && writer !== filePath;
  }

  /**
   * Whether some file reads a property named `name` as a value, or the file of `classId` reads the class, its
   * prototype or an instance by a computed key (XA-04), so a method may run with another `this`.
   */
  public isBorrowed(name: string, classId?: string): boolean {
    return this.borrowed.has(name) || (classId !== undefined && this.classes.get(classId)?.computedReads === true);
  }

  /**
   * Whether code outside the analysed files may extend `classId` or a class below it (open world): the class, or any
   * class that extends it here, escapes its file or is not known (XA-02).
   */
  private mayBeExtendedOutside(classId: string): boolean {
    let open = this.openCache.get(classId);
    if (open === undefined) {
      open = this.subtreeEscapes(classId, new Set());
      this.openCache.set(classId, open);
    }
    return open;
  }

  private subtreeEscapes(classId: string, seen: Set<string>): boolean {
    if (seen.has(classId)) return false;
    seen.add(classId);
    if (this.classes.get(classId)?.escapes !== false) return true;
    return this.children(classId).some((child) => this.subtreeEscapes(child.id, seen));
  }

  /** The classes that extend `classId` directly: by name in its file, or through an import of its file. */
  private children(classId: string): readonly ClassFact[] {
    const fact = this.classes.get(classId);
    return [
      ...(this.childrenByClass.get(classId) ?? []),
      ...(fact === undefined ? [] : this.childrenByFile.get(fact.filePath) ?? []),
    ];
  }

  private subtreeMembers(classId: string, seen: Set<string>): Set<string> {
    const names = new Set<string>();
    if (seen.has(classId)) return names;
    seen.add(classId);
    for (const child of this.children(classId)) {
      for (const name of this.ownMembers(child)) names.add(name);
      for (const name of this.subtreeMembers(child.id, seen)) names.add(name);
    }
    return names;
  }

  /**
   * A subclass's own members, and every property name its file writes by name (`Sub.prototype.m = …`). A write by
   * computed key in that file (`obj[key] = …`, everywhere in real code) is not counted, as stated above.
   */
  private ownMembers(fact: ClassFact): Set<string> {
    const written = [...(this.writtenByFile.get(fact.filePath) ?? [])].filter((name) => name !== COMPUTED);
    return new Set([...fact.members, ...written]);
  }
}
