import type { ASTNode } from "@parser/index";
import { compareCodePoints } from "@shared/ordering";

import type { ControlFlowGraphsWithNodes } from "./control-flow-builder";
import type { ControlFlowGraph } from "./flow-contracts";

/**
 * Wave 3a (WAVE3-DFG-DESIGN.md): forward data flow over one control-flow graph.
 *
 * Per binding the state holds its reaching definitions and its taint, `sourceId -> must`, where
 * must means the source reaches this point on every path from the entry. At a path join, may facts
 * are a union and must facts an intersection. Blocks are solved to a fixed point in reverse
 * postorder; the lattice is finite, so no widening is needed. Expression-level control (`&&`, `||`,
 * `??`, `?:`, logical assignment, optional calls) forks and joins inside a statement, and a test
 * produces uses only, never data (BA-06). Nested function bodies are not evaluated here.
 */

/** Taint of a value: each source that may reach it, and whether it must. */
export type Taint = ReadonlyMap<string, boolean>;
export interface TaintEntry { readonly sourceId: string; readonly must: boolean }
interface BindingFacts { readonly definitions: ReadonlySet<string>; readonly taint: Taint }
type Facts = ReadonlyMap<string, BindingFacts>;

export interface DataFlowContext {
  /** Id of the definition `node` (the defining identifier) creates for `binding`. */
  definitionId(node: ASTNode, binding: string): string;
  /** Source id when this call or member read produces tainted data. */
  sourceOf(node: ASTNode): string | undefined;
  /** Source id when `keys` destructured from the expression `object` name a source; `at` is the property. */
  sourceOfDestructured?(object: ASTNode, keys: readonly string[], at: ASTNode): string | undefined;
  /** Binding key for an identifier; the name by default. */
  bindingOf?(identifier: ASTNode, name: string): string;
  /** Value of a call that is not a source, from its callee and argument values; untainted by default. */
  callValue?(call: ASTNode, callee: Taint, args: readonly Taint[]): Taint;
  /** Adjusts what a read sees, e.g. for a binding another function can write (closures). */
  readTaint?(binding: string, taint: Taint): Taint;
  /** Called once per assignment on the recording pass. */
  onAssign?(binding: string, taint: Taint): void;
}

/** A binding key for the static member path `base.p.q` (Wave 3b): `base#p.q`. */
export function memberBindingKey(base: string, properties: readonly string[]): string { return `${base}#${properties.join(".")}`; }

/** The same sources, none of them must. */
export function mayOnly(taint: Taint): Taint {
  let allMay = true;
  for (const must of taint.values()) if (must) { allMay = false; break; }
  return allMay ? taint : new Map([...taint.keys()].map((sourceId) => [sourceId, false]));
}

export interface UseFact { readonly node: ASTNode; readonly binding: string; readonly definitions: readonly string[]; readonly taint: readonly TaintEntry[] }
export interface CallFact { readonly node: ASTNode; readonly argumentTaint: readonly (readonly TaintEntry[])[] }
export interface ControlFlowDataFlow {
  /** Facts on entry to each reachable block. */
  readonly blockIn: ReadonlyMap<string, Facts>;
  readonly uses: readonly UseFact[];
  readonly calls: readonly CallFact[];
  /** Every source evaluated in this graph, sorted. */
  readonly sourceIds: readonly string[];
}

const EMPTY_TAINT: Taint = new Map();
const NO_DEFINITIONS: ReadonlySet<string> = new Set();
const UNBOUND: BindingFacts = { definitions: NO_DEFINITIONS, taint: EMPTY_TAINT };
/** Edges taken after a statement inside the block may have thrown: they see every intermediate state. */
const ABRUPT_EDGES = new Set(["exception", "throw", "finally"]);
const MAX_ROUNDS = 10_000;

/** Path join: every source that reaches either side, must only if must on both. */
export function joinTaint(left: Taint, right: Taint): Taint {
  if (left === right) return left;
  const joined = new Map<string, boolean>();
  for (const [sourceId, must] of left) joined.set(sourceId, must && right.get(sourceId) === true);
  for (const sourceId of right.keys()) if (!left.has(sourceId)) joined.set(sourceId, false);
  return joined;
}

/** Value combination (`a + b`): a source is must when either operand must carry it. */
export function combineTaint(left: Taint, right: Taint): Taint {
  if (right.size === 0) return left;
  if (left.size === 0) return right;
  const combined = new Map(left);
  for (const [sourceId, must] of right) combined.set(sourceId, (combined.get(sourceId) ?? false) || must);
  return combined;
}

function joinBinding(left: BindingFacts, right: BindingFacts): BindingFacts {
  if (left === right) return left;
  const definitions = left.definitions.size === 0 ? right.definitions : right.definitions.size === 0 ? left.definitions : new Set([...left.definitions, ...right.definitions]);
  return { definitions, taint: joinTaint(left.taint, right.taint) };
}

function joinFacts(left: Facts, right: Facts): Facts {
  if (left === right) return left;
  const joined = new Map<string, BindingFacts>();
  for (const [binding, facts] of left) joined.set(binding, joinBinding(facts, right.get(binding) ?? UNBOUND));
  for (const [binding, facts] of right) if (!left.has(binding)) joined.set(binding, joinBinding(UNBOUND, facts));
  return joined;
}

function sameTaint(left: Taint, right: Taint): boolean {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const [sourceId, must] of left) if (right.get(sourceId) !== must) return false;
  return true;
}

function sameFacts(left: Facts, right: Facts): boolean {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const [binding, facts] of left) {
    const other = right.get(binding);
    if (other === undefined || other.definitions.size !== facts.definitions.size || !sameTaint(other.taint, facts.taint)) return false;
    for (const id of facts.definitions) if (!other.definitions.has(id)) return false;
  }
  return true;
}

function entries(taint: Taint): readonly TaintEntry[] {
  return [...taint].map(([sourceId, must]) => ({ sourceId, must })).sort((left, right) => compareCodePoints(left.sourceId, right.sourceId));
}

function role(node: ASTNode, name: string): ASTNode | undefined { return node.children.find((child) => child.role === name); }
function roles(node: ASTNode, name: string): readonly ASTNode[] { return node.children.filter((child) => child.role === name); }
function identifierName(node: ASTNode): string | undefined { const value = node.attributes.name; return typeof value === "string" ? value : undefined; }

const FUNCTION_TYPES = new Set(["FunctionExpression", "ArrowFunctionExpression", "FunctionDeclaration", "ClassExpression", "ObjectMethod", "ClassMethod", "ClassPrivateMethod"]);
const TS_VALUE_WRAPPERS = new Set(["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion", "TSInstantiationExpression"]);
const TYPE_ROLES = new Set(["typeAnnotation", "typeParameters", "typeArguments", "returnType", "label"]);

/**
 * A value with the shape a literal gives it, so destructuring binds each target from its own part:
 * `[a, b] = [x, y]` binds `a` from `x` only. `definite` means known not to be undefined (a default
 * is then skipped); `missing` means known undefined (the default is taken).
 */
interface Structured {
  readonly taint: Taint;
  /** The expression (and keys below it) this value was read from, when it is a name or member path. */
  readonly origin?: { readonly object: ASTNode; readonly keys: readonly string[]; readonly sourced: boolean };
  readonly fields?: ReadonlyMap<string, Structured>;
  readonly elements?: readonly Structured[];
  readonly definite?: boolean;
  readonly missing?: boolean;
}
const MISSING: Structured = { taint: EMPTY_TAINT, missing: true };
const LITERAL_TYPES = new Set(["StringLiteral", "NumericLiteral", "BooleanLiteral", "NullLiteral", "BigIntLiteral", "RegExpLiteral"]);

function staticKey(property: ASTNode): string | undefined {
  if (property.attributes.computed === true) return undefined;
  const key = role(property, "key");
  if (key === undefined) return undefined;
  if (key.type === "Identifier") return identifierName(key);
  const value = key.attributes.value;
  return key.type === "StringLiteral" || key.type === "NumericLiteral" ? String(value) : undefined;
}

/** The mutable state while one block is evaluated. Forks copy; every overwritten value is noted for abrupt edges. */
class State {
  public constructor(public facts: Map<string, BindingFacts>, private readonly overwritten: Map<string, BindingFacts>) {}
  public get(binding: string): BindingFacts { return this.facts.get(binding) ?? UNBOUND; }
  public set(binding: string, facts: BindingFacts): void {
    const previous = this.get(binding);
    this.overwritten.set(binding, joinBinding(this.overwritten.get(binding) ?? previous, previous));
    this.facts.set(binding, facts);
  }
  public fork(): State { return new State(new Map(this.facts), this.overwritten); }
  public joinWith(other: State): void { this.facts = new Map(joinFacts(this.facts, other.facts)); }
}

class Evaluator {
  public constructor(
    private readonly context: DataFlowContext,
    private readonly uses: UseFact[] | undefined,
    private readonly calls: CallFact[] | undefined,
    private readonly sources?: Set<string>,
  ) {}

  private silent = 0;

  private bindingOf(node: ASTNode, name: string): string { return this.context.bindingOf?.(node, name) ?? name; }

  /** Whether this is the recording pass (uses, calls and assignments are reported). */
  private get recording(): boolean { return this.uses !== undefined; }

  private read(binding: string, state: State): BindingFacts {
    const facts = state.get(binding);
    const taint = this.context.readTaint?.(binding, facts.taint) ?? facts.taint;
    return taint === facts.taint ? facts : { definitions: facts.definitions, taint };
  }

  private define(target: ASTNode, binding: string, taint: Taint, state: State): void {
    state.set(binding, { definitions: new Set([this.context.definitionId(target, binding)]), taint });
    if (this.recording) this.context.onAssign?.(binding, taint);
  }

  /** `base.p.q` with only non-computed properties on an identifier: its base identifier and properties. */
  private staticPath(node: ASTNode): { readonly base: ASTNode; readonly properties: readonly string[] } | undefined {
    const properties: string[] = [];
    let current = node;
    while (current.type === "MemberExpression" || current.type === "OptionalMemberExpression") {
      const property = role(current, "property");
      const name = current.attributes.computed === true || property === undefined ? undefined : identifierName(property);
      if (name === undefined) return undefined;
      properties.unshift(name);
      const object = role(current, "object");
      if (object === undefined) return undefined;
      current = object;
    }
    return current.type === "Identifier" && identifierName(current) !== undefined ? { base: current, properties } : undefined;
  }

  private source(node: ASTNode): Taint | undefined {
    const sourceId = this.context.sourceOf(node);
    if (sourceId === undefined) return undefined;
    this.sources?.add(sourceId);
    return new Map([[sourceId, true]]);
  }

  public statement(node: ASTNode, state: State): void {
    switch (node.type) {
      case "VariableDeclaration": {
        const kind = node.attributes.kind;
        for (const declarator of roles(node, "declarations")) {
          const id = role(declarator, "id");
          const init = role(declarator, "init");
          if (id === undefined) continue;
          // `var x;` re-declares without assigning; `let x;` initialises to undefined.
          if (init !== undefined) this.bind(id, this.structured(init, state), state);
          else if (kind !== "var") this.assign(id, EMPTY_TAINT, state);
        }
        return;
      }
      case "ExpressionStatement": this.optional(role(node, "expression"), state); return;
      case "ReturnStatement": case "ThrowStatement": this.optional(role(node, "argument"), state); return;
      case "IfStatement": case "WhileStatement": case "ForStatement": this.optional(role(node, "test"), state); return;
      case "ForInStatement": case "ForOfStatement": {
        // The iterable was evaluated (and its uses recorded) before the loop; the header binds its elements.
        // for-in binds property keys: whether keys carry taint is a policy question (BA-07), so they do not yet.
        const right = role(node, "right");
        const left = role(node, "left");
        if (right === undefined || left === undefined) return;
        this.silent++;
        const iterated = this.expression(right, state);
        this.silent--;
        const value = node.type === "ForInStatement" ? EMPTY_TAINT : iterated;
        const target = left.type === "VariableDeclaration" ? role(roles(left, "declarations")[0] ?? left, "id") : left;
        if (target !== undefined) this.assign(target, value, state);
        return;
      }
      case "SwitchStatement": {
        this.optional(role(node, "discriminant"), state);
        for (const branch of roles(node, "cases")) {
          const test = role(branch, "test");
          if (test === undefined) continue;
          const fork = state.fork();
          this.expression(test, fork);
          state.joinWith(fork);
        }
        return;
      }
      case "ClassDeclaration": { const id = role(node, "id"); if (id !== undefined) this.assign(id, EMPTY_TAINT, state); return; }
      case "ExportNamedDeclaration": { const declaration = role(node, "declaration"); if (declaration !== undefined) this.statement(declaration, state); return; }
      case "ExportDefaultDeclaration": { const declaration = role(node, "declaration"); if (declaration !== undefined && !FUNCTION_TYPES.has(declaration.type)) this.statement(declaration, state); return; }
      // Markers whose parts live in their own blocks.
      case "BlockStatement": case "TryStatement": case "DoWhileStatement": case "LabeledStatement": case "BreakStatement":
      case "ContinueStatement": case "EmptyStatement": case "DebuggerStatement": case "FunctionDeclaration":
      case "ImportDeclaration": case "ExportAllDeclaration":
        return;
      default:
        // Loop clauses (for init/update, for-in/of object, do-while test) are bare expressions.
        if (!node.type.endsWith("Statement") && !node.type.endsWith("Declaration")) this.expression(node, state);
    }
  }

  private optional(node: ASTNode | undefined, state: State): void { if (node !== undefined) this.expression(node, state); }

  public expression(node: ASTNode, state: State): Taint {
    if (FUNCTION_TYPES.has(node.type)) return EMPTY_TAINT;
    if (node.type.startsWith("TS") && !TS_VALUE_WRAPPERS.has(node.type)) return EMPTY_TAINT;
    switch (node.type) {
      case "Identifier": {
        const name = identifierName(node);
        if (name === undefined || name === "undefined") return EMPTY_TAINT;
        const binding = this.bindingOf(node, name);
        const facts = this.read(binding, state);
        if (this.silent === 0) this.uses?.push({ node, binding, definitions: [...facts.definitions].sort(compareCodePoints), taint: entries(facts.taint) });
        // A binding destructured from a request source is itself that source.
        const source = this.source(node);
        return source === undefined ? facts.taint : combineTaint(facts.taint, source);
      }
      case "AssignmentExpression": return this.assignment(node, state);
      case "UpdateExpression": {
        const argument = role(node, "argument");
        if (argument === undefined) return EMPTY_TAINT;
        const value = this.expression(argument, state);
        this.assign(argument, value, state);
        return value;
      }
      case "LogicalExpression": {
        const left = this.optionalValue(role(node, "left"), state);
        const fork = state.fork();
        const right = this.optionalValue(role(node, "right"), fork);
        state.joinWith(fork);
        return joinTaint(left, right);
      }
      case "ConditionalExpression": {
        this.optional(role(node, "test"), state);
        const yes = state.fork();
        const no = state.fork();
        const consequent = this.optionalValue(role(node, "consequent"), yes);
        const alternate = this.optionalValue(role(node, "alternate"), no);
        state.facts = new Map(joinFacts(yes.facts, no.facts));
        return joinTaint(consequent, alternate);
      }
      case "CallExpression": case "OptionalCallExpression": case "NewExpression": {
        const callee = role(node, "callee");
        const calleeTaint = callee === undefined ? EMPTY_TAINT : this.expression(callee, state);
        // `f?.(args)` may skip its arguments.
        const target = node.attributes.optional === true ? state.fork() : state;
        const argumentTaint = roles(node, "arguments").map((argument) => this.expression(argument, target));
        if (target !== state) state.joinWith(target);
        if (this.silent === 0) this.calls?.push({ node, argumentTaint: argumentTaint.map(entries) });
        return this.source(node) ?? this.context.callValue?.(node, calleeTaint, argumentTaint) ?? EMPTY_TAINT;
      }
      case "MemberExpression": case "OptionalMemberExpression": {
        const source = this.source(node);
        if (source !== undefined) return source;
        let value = this.optionalValue(role(node, "object"), state);
        const property = role(node, "property");
        if (node.attributes.computed === true && property !== undefined) this.expression(property, state);
        // The longest prefix of this path written here (`o.p` for `o.p.q`) holds the value instead of
        // the object; writes seen only from other functions add to it as may facts.
        const path = this.staticPath(node);
        const baseName = path === undefined ? undefined : identifierName(path.base);
        if (path !== undefined && baseName !== undefined) {
          const base = this.bindingOf(path.base, baseName);
          for (let length = 1; length <= path.properties.length; length++) {
            const key = memberBindingKey(base, path.properties.slice(0, length));
            const held = this.read(key, state).taint;
            value = state.get(key).definitions.size > 0 ? held : combineTaint(value, held);
          }
        }
        return value;
      }
      case "SequenceExpression": {
        let value = EMPTY_TAINT;
        for (const expression of roles(node, "expressions")) value = this.expression(expression, state);
        return value;
      }
      default: {
        let value = EMPTY_TAINT;
        for (const child of node.children) {
          if (child.role !== undefined && TYPE_ROLES.has(child.role)) continue;
          // A non-computed object key names a property; it reads nothing.
          if (child.role === "key" && node.attributes.computed !== true) continue;
          value = combineTaint(value, this.expression(child, state));
        }
        return value;
      }
    }
  }

  private optionalValue(node: ASTNode | undefined, state: State): Taint { return node === undefined ? EMPTY_TAINT : this.expression(node, state); }

  private assignment(node: ASTNode, state: State): Taint {
    const operator = node.attributes.operator;
    const left = role(node, "left");
    const right = role(node, "right");
    if (left === undefined) return EMPTY_TAINT;
    if (operator === "&&=" || operator === "||=" || operator === "??=") {
      const old = this.expression(left, state);
      const fork = state.fork();
      const value = this.optionalValue(right, fork);
      this.assign(left, value, fork);
      state.joinWith(fork);
      return joinTaint(old, value);
    }
    if (operator === "=" && right !== undefined && (left.type === "ObjectPattern" || left.type === "ArrayPattern")) {
      const value = this.structured(right, state);
      this.bind(left, value, state);
      return value.taint;
    }
    const value = operator === "="
      ? this.optionalValue(right, state)
      : combineTaint(this.expression(left, state), this.optionalValue(right, state));
    this.assign(left, value, state);
    return value;
  }

  /** Evaluates `node` completely (in order), keeping the parts an object or array literal gives it. */
  private structured(node: ASTNode, state: State): Structured {
    if (LITERAL_TYPES.has(node.type)) return { taint: EMPTY_TAINT, definite: true };
    if (node.type === "Identifier" && identifierName(node) === "undefined") return MISSING;
    if (node.type === "ObjectExpression" && node.children.every((child) => (child.type === "ObjectProperty" || child.type === "ObjectMethod") && staticKey(child) !== undefined)) {
      const fields = new Map<string, Structured>();
      let taint = EMPTY_TAINT;
      for (const property of node.children) {
        const value = property.type === "ObjectProperty" ? role(property, "value") : undefined;
        const part = value === undefined ? { taint: EMPTY_TAINT, definite: true } : this.structured(value, state);
        fields.set(staticKey(property)!, part);
        taint = combineTaint(taint, part.taint);
      }
      return { taint, fields, definite: true };
    }
    if (node.type === "ArrayExpression" && node.children.every((child) => child.type !== "SpreadElement")) {
      const elements = node.children.filter((child) => child.role === "elements").map((child) => child.type === "ArrayHole" ? MISSING : this.structured(child, state));
      return { taint: elements.reduce((taint, part) => combineTaint(taint, part.taint), EMPTY_TAINT), elements, definite: true };
    }
    const taint = this.expression(node, state);
    // `sourced`: the expression itself is a source, so a key destructured from it adds no second one.
    return node.type === "Identifier" || node.type === "MemberExpression" ? { taint, origin: { object: node, keys: [], sourced: this.context.sourceOf(node) !== undefined } } : { taint };
  }

  /** The part of `value` under `key`: from a literal's fields, or a source the policy names for its origin. */
  private part(value: Structured, key: string, at: ASTNode): Structured {
    if (value.origin === undefined) return { taint: value.taint };
    const keys = [...value.origin.keys, key];
    const sourceId = value.origin.sourced ? undefined : this.context.sourceOfDestructured?.(value.origin.object, keys, at);
    if (sourceId !== undefined) this.sources?.add(sourceId);
    const taint = sourceId === undefined ? value.taint : combineTaint(value.taint, new Map([[sourceId, true]]));
    return { taint, origin: { object: value.origin.object, keys, sourced: value.origin.sourced || sourceId !== undefined } };
  }

  /** Binds a pattern from a structured value: each target from its own part where the shape is known. */
  private bind(target: ASTNode, value: Structured, state: State): void {
    switch (target.type) {
      case "ObjectPattern": {
        if (value.fields === undefined && value.origin === undefined) { this.assign(target, value.taint, state); return; }
        if (value.fields === undefined) {
          for (const property of target.children) {
            if (property.type === "RestElement") { const argument = role(property, "argument"); if (argument !== undefined) this.assign(argument, value.taint, state); continue; }
            if (property.type !== "ObjectProperty") continue;
            const key = staticKey(property);
            const binding = role(property, "value");
            if (key === undefined) { const computed = role(property, "key"); if (computed !== undefined) this.expression(computed, state); }
            if (binding !== undefined) this.bind(binding, key === undefined ? { taint: value.taint } : this.part(value, key, property), state);
          }
          return;
        }
        const named = new Set<string>();
        for (const property of target.children) {
          if (property.type === "RestElement") continue;
          if (property.type !== "ObjectProperty") continue;
          const key = staticKey(property);
          const binding = role(property, "value");
          if (key === undefined) {
            const computed = role(property, "key");
            if (computed !== undefined) this.expression(computed, state);
            if (binding !== undefined) this.assign(binding, value.taint, state);
            continue;
          }
          named.add(key);
          if (binding !== undefined) this.bind(binding, value.fields.get(key) ?? MISSING, state);
        }
        for (const property of target.children) {
          if (property.type !== "RestElement") continue;
          const argument = role(property, "argument");
          let rest = EMPTY_TAINT;
          for (const [key, part] of value.fields) if (!named.has(key)) rest = combineTaint(rest, part.taint);
          if (argument !== undefined) this.assign(argument, rest, state);
        }
        return;
      }
      case "ArrayPattern": {
        if (value.elements === undefined) { this.assign(target, value.taint, state); return; }
        const elements = roles(target, "elements");
        for (const [index, element] of elements.entries()) {
          if (element.type === "ArrayHole") continue;
          if (element.type === "RestElement") {
            const argument = role(element, "argument");
            const rest = value.elements.slice(index).reduce((taint, part) => combineTaint(taint, part.taint), EMPTY_TAINT);
            if (argument !== undefined) this.assign(argument, rest, state);
            break;
          }
          this.bind(element, value.elements[index] ?? MISSING, state);
        }
        return;
      }
      case "AssignmentPattern": {
        const left = role(target, "left");
        if (left === undefined) return;
        const fallback = role(target, "right");
        if (value.definite === true || fallback === undefined) { this.bind(left, value, state); return; }
        if (value.missing === true) { this.bind(left, this.structured(fallback, state), state); return; }
        this.assign(target, value.taint, state);
        return;
      }
      default:
        this.assign(target, value.taint, state);
    }
  }

  /**
   * Binds `target` (identifier or pattern) to `value`. A static member path `o.p` is its own binding
   * (strong update); the object itself then may hold the value. Other member writes only make the
   * base object may-hold the value (no heap model).
   */
  private assign(target: ASTNode, value: Taint, state: State): void {
    switch (target.type) {
      case "Identifier": {
        const name = identifierName(target);
        if (name === undefined) return;
        this.define(target, this.bindingOf(target, name), value, state);
        return;
      }
      case "MemberExpression": case "OptionalMemberExpression": {
        const object = role(target, "object");
        const property = role(target, "property");
        if (object !== undefined) this.expression(object, state);
        if (target.attributes.computed === true && property !== undefined) this.expression(property, state);
        const path = this.staticPath(target);
        let base: ASTNode | undefined = object;
        while (base !== undefined && (base.type === "MemberExpression" || base.type === "OptionalMemberExpression")) base = role(base, "object");
        const baseName = base?.type === "Identifier" ? identifierName(base) : undefined;
        if (base === undefined || baseName === undefined) return;
        const baseKey = this.bindingOf(base, baseName);
        if (path !== undefined) this.define(target, memberBindingKey(baseKey, path.properties), value, state);
        const held = this.read(baseKey, state);
        const widened = combineTaint(held.taint, mayOnly(value));
        if (!sameTaint(widened, held.taint)) state.set(baseKey, { definitions: held.definitions, taint: widened });
        // Reported even when unchanged here: the write happens on every evaluation (closure rounds rely on it).
        if (this.recording) this.context.onAssign?.(baseKey, mayOnly(value));
        return;
      }
      case "ObjectPattern":
        for (const property of target.children) {
          if (property.type === "RestElement") { const argument = role(property, "argument"); if (argument !== undefined) this.assign(argument, value, state); continue; }
          if (property.type !== "ObjectProperty") continue;
          const key = role(property, "key");
          if (property.attributes.computed === true && key !== undefined) this.expression(key, state);
          const binding = role(property, "value");
          if (binding !== undefined) this.assign(binding, value, state);
        }
        return;
      case "ArrayPattern":
        for (const element of roles(target, "elements")) this.assign(element, value, state);
        return;
      case "RestElement": { const argument = role(target, "argument"); if (argument !== undefined) this.assign(argument, value, state); return; }
      case "AssignmentPattern": {
        // The default is evaluated only when the value is undefined.
        const fork = state.fork();
        const fallback = this.optionalValue(role(target, "right"), fork);
        state.joinWith(fork);
        const left = role(target, "left");
        if (left !== undefined) this.assign(left, joinTaint(value, fallback), state);
        return;
      }
      default:
        if (target.type.startsWith("TS") && TS_VALUE_WRAPPERS.has(target.type)) { const inner = role(target, "expression"); if (inner !== undefined) this.assign(inner, value, state); return; }
        this.expression(target, state);
    }
  }
}

function reversePostorder(graph: ControlFlowGraph, successors: ReadonlyMap<string, readonly string[]>): readonly string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const stack: { readonly id: string; next: number }[] = [{ id: graph.entryBlockId, next: 0 }];
  seen.add(graph.entryBlockId);
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    const targets = successors.get(frame.id) ?? [];
    if (frame.next < targets.length) {
      const target = targets[frame.next++]!;
      if (!seen.has(target)) { seen.add(target); stack.push({ id: target, next: 0 }); }
    } else {
      order.push(frame.id);
      stack.pop();
    }
  }
  return order.reverse();
}

/** Solves one graph to its fixed point, then evaluates each reachable block once more to record uses and calls. */
export function analyzeControlFlow(graph: ControlFlowGraph, nodes: Pick<ControlFlowGraphsWithNodes, "statementNodes" | "blockClauses">, context: DataFlowContext): ControlFlowDataFlow {
  const blocks = new Map(graph.blocks.map((block) => [block.id, block]));
  const successors = new Map<string, string[]>();
  const incoming = new Map<string, { readonly from: string; readonly abrupt: boolean }[]>();
  for (const edge of graph.edges) {
    successors.set(edge.fromBlockId, [...(successors.get(edge.fromBlockId) ?? []), edge.toBlockId]);
    incoming.set(edge.toBlockId, [...(incoming.get(edge.toBlockId) ?? []), { from: edge.fromBlockId, abrupt: ABRUPT_EDGES.has(edge.kind) }]);
  }
  const order = reversePostorder(graph, successors);
  const evaluates = new Set(graph.blocks.filter((block) => (nodes.blockClauses.get(block.id)?.length ?? 0) > 0 || block.statements.some((statement) => nodes.statementNodes.has(statement.id))).map((block) => block.id));

  const runBlock = (blockId: string, entry: Facts, evaluator: Evaluator): { readonly out: Facts; readonly abrupt: Facts } => {
    // A block that evaluates nothing (an expression decision or arm; data flow evaluates the whole statement
    // where it completes) passes its entry state through unchanged and uncopied.
    if (!evaluates.has(blockId)) return { out: entry, abrupt: entry };
    const overwritten = new Map<string, BindingFacts>();
    const state = new State(new Map(entry), overwritten);
    for (const statement of blocks.get(blockId)?.statements ?? []) {
      const node = nodes.statementNodes.get(statement.id);
      if (node !== undefined) evaluator.statement(node, state);
    }
    for (const clause of nodes.blockClauses.get(blockId) ?? []) evaluator.expression(clause, state);
    const out: Facts = state.facts;
    return { out, abrupt: overwritten.size === 0 ? out : joinFacts(out, overwritten) };
  };

  const blockIn = new Map<string, Facts>();
  const blockOut = new Map<string, { readonly out: Facts; readonly abrupt: Facts }>();
  const solver = new Evaluator(context, undefined, undefined);
  let changed = true;
  for (let round = 0; changed; round++) {
    if (round >= MAX_ROUNDS) throw new Error(`Data flow did not converge: ${graph.id}`);
    changed = false;
    for (const blockId of order) {
      let entry: Facts | undefined = blockId === graph.entryBlockId ? new Map() : undefined;
      for (const edge of incoming.get(blockId) ?? []) {
        const from = blockOut.get(edge.from);
        if (from === undefined) continue;
        const state = edge.abrupt ? from.abrupt : from.out;
        entry = entry === undefined ? state : joinFacts(entry, state);
      }
      if (entry === undefined) continue;
      const previous = blockIn.get(blockId);
      if (previous !== undefined && sameFacts(previous, entry)) continue;
      blockIn.set(blockId, entry);
      blockOut.set(blockId, runBlock(blockId, entry, solver));
      changed = true;
    }
  }

  const uses: UseFact[] = [];
  const calls: CallFact[] = [];
  const sources = new Set<string>();
  const recorder = new Evaluator(context, uses, calls, sources);
  for (const blockId of order) {
    const entry = blockIn.get(blockId);
    if (entry !== undefined) runBlock(blockId, entry, recorder);
  }
  const position = (node: ASTNode): readonly [number, number] => [node.location?.start.line ?? 0, node.location?.start.column ?? 0];
  const byPosition = (left: ASTNode, right: ASTNode): number => {
    const [leftLine, leftColumn] = position(left);
    const [rightLine, rightColumn] = position(right);
    return leftLine - rightLine || leftColumn - rightColumn;
  };
  uses.sort((left, right) => byPosition(left.node, right.node) || compareCodePoints(left.binding, right.binding));
  calls.sort((left, right) => byPosition(left.node, right.node));
  return { blockIn, uses, calls, sourceIds: [...sources].sort(compareCodePoints) };
}
