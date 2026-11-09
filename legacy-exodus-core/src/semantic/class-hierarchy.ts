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
 * methods are open unless the hierarchy is built closed-world. A class that does not escape can only be extended in
 * its own file.
 *
 * Assumptions, as elsewhere in the call graph: other files do not write or read methods by computed key or reflection (`proto[name] = f`,
 * `Reflect.get(o, "run")`; the calling file's own such writes are checked there), and a class body is strict mode
 * (an unbound method call has no `this`, so it throws rather than reaching another object).
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
}

export interface ClassHierarchyFile {
  readonly filePath: string;
  readonly classes: readonly ClassFact[];
  /** Property names the file writes (`x.m = …`), `*` for a computed one. */
  readonly writtenNames: readonly string[];
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
  const borrowed = new Set<string>();
  const valueUses = new Map<string, number>();

  const visit = (node: ASTNode, parent: ASTNode | undefined): void => {
    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      const symbol = node.location === undefined ? undefined : classByStart.get(`${node.location.start.line}:${node.location.start.column}`);
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
    if (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") {
      const name = memberPropertyName(node);
      const role = node.role;
      const called = (parent?.type === "CallExpression" || parent?.type === "OptionalCallExpression" || parent?.type === "NewExpression") && role === "callee";
      const tagged = parent?.type === "TaggedTemplateExpression" && role === "tag";
      if (parent?.type === "AssignmentExpression" && role === "left") written.add(name ?? COMPUTED);
      else if (!called && !tagged && name !== undefined && parent?.type !== "UpdateExpression"
        && !(parent?.type === "UnaryExpression" && parent.attributes.operator === "delete")) borrowed.add(name);
    }
    if (node.type === "ObjectPattern") {
      // Destructuring reads each named property as a value: `const { run } = obj`.
      for (const property of node.children) {
        if (property.type !== "ObjectProperty") continue;
        const name = keyName(property);
        if (name !== undefined) borrowed.add(name);
      }
    }
    if (node.type === "Identifier" && isValueUse(node, parent)) {
      const name = nameOf(node);
      if (name !== undefined) valueUses.set(name, (valueUses.get(name) ?? 0) + 1);
    }
    for (const child of node.children) visit(child, node);
  };
  visit(ast.root, undefined);
  return {
    filePath,
    classes: classes.map(({ name, expression, exported, ...fact }) => ({
      ...fact,
      escapes: exported || expression || name === undefined || (valueUses.get(name) ?? 0) > 0,
    })),
    writtenNames: [...written].sort(),
    borrowedNames: [...borrowed].sort(),
  };
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
    if (node.type === "AssignmentExpression") {
      const left = node.children.find((child) => child.role === "left");
      if ((left?.type === "MemberExpression" || left?.type === "OptionalMemberExpression")
        && left.children.find((child) => child.role === "object")?.type === "ThisExpression") members.add(memberPropertyName(left) ?? COMPUTED);
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
  private readonly overrideCache = new Map<string, ReadonlySet<string>>();

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

  /** Whether a class that extends `classId`, directly or not, anywhere in the repository may define `name`. */
  public mayOverride(classId: string, name: string): boolean {
    if (!this.closedWorld && this.classes.get(classId)?.escapes !== false) return true;
    if (this.unknownOverrides.has(name) || this.unknownOverrides.has(COMPUTED)) return true;
    let names = this.overrideCache.get(classId);
    if (names === undefined) {
      names = this.subtreeMembers(classId, new Set());
      this.overrideCache.set(classId, names);
    }
    return names.has(name) || names.has(COMPUTED);
  }

  /** Whether some file reads a property named `name` as a value, so a method of that name may run with another `this`. */
  public isBorrowed(name: string): boolean {
    return this.borrowed.has(name);
  }

  private subtreeMembers(classId: string, seen: Set<string>): Set<string> {
    const names = new Set<string>();
    if (seen.has(classId)) return names;
    seen.add(classId);
    const fact = this.classes.get(classId);
    const children = [
      ...(this.childrenByClass.get(classId) ?? []),
      ...(fact === undefined ? [] : this.childrenByFile.get(fact.filePath) ?? []),
    ];
    for (const child of children) {
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
