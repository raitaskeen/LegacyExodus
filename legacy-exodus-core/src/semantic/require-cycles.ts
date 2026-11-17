/**
 * RT-M9: modules that load each other (a require cycle). When a.js runs `require("./b")` and b.js runs
 * `require("./a")` while a.js is still loading, b gets a's exports object as it is at that moment. If a.js then
 * replaces `module.exports`, b keeps the stale object for the rest of the run; members a.js adds later are missing
 * from it until a.js finishes. Which file loads first depends on the entry point, which is not known here.
 */
import type { ASTNode, ASTResult } from "@parser/index";
import { canonicalizePath } from "@graph/index";
import type { CodeSymbol } from "@symbols/index";

interface SourcePoint { readonly line: number; readonly column: number }

/** What the call graph needs from a run's require cycles. */
export interface RequireCycleFacts {
  /**
   * Per file, its imports whose module is in the file's own cycle (a load-time call through one may run too early),
   * each mapped to whether that module may leave it holding a replaced `module.exports` for the whole run (stale).
   * An importer outside the cycle is not listed: it cannot load while the cycle does, so it gets the final object.
   */
  readonly cycleImports: ReadonlyMap<string, ReadonlyMap<string, boolean>>;
}

/** Both uses of the cycles, for the run: `symbolsOf` gives a file's symbols, `resolve` the file a specifier loads. */
export function requireCycleFacts(
  facts: readonly LoadTimeModuleFacts[],
  resolve: (importer: string, specifier: string) => string | undefined,
  symbolsOf: (filePath: string) => readonly CodeSymbol[],
): RequireCycleFacts {
  const cycles = requireCycles(facts, resolve);
  const stale = staleExportFiles(facts, cycles, resolve);
  const cycleImports = new Map<string, Map<string, boolean>>();
  for (const [file, cycle] of [...cycles].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))) {
    for (const symbol of symbolsOf(file)) {
      const target = symbol.kind === "import" && typeof symbol.moduleSpecifier === "string" ? resolve(file, symbol.moduleSpecifier) : undefined;
      if (target !== undefined && cycle.has(target)) cycleImports.set(file, (cycleImports.get(file) ?? new Map()).set(symbol.id, stale.has(target)));
    }
  }
  return { cycleImports };
}

/** What a file does while it loads: the modules it loads, and where it replaces `module.exports`. */
export interface LoadTimeModuleFacts {
  readonly filePath: string;
  /**
   * `require("x")` and TypeScript's `import x = require("x")` outside any function, and static `import`/`export … from`
   * (these load before the body runs). An import that compiles away is no load: `import type`, `export type … from`,
   * and in a TypeScript file an import whose names are used only as types.
   */
  readonly loads: readonly { readonly specifier: string; readonly at: SourcePoint }[];
  /** `module.exports = …` outside any function (`exports = module.exports = …` included). */
  readonly exportsReplacedAt: readonly SourcePoint[];
}

const CALLABLE = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ClassMethod", "ClassPrivateMethod", "ObjectMethod"]);
const BEFORE_BODY: SourcePoint = { line: 0, column: 0 };
const TYPESCRIPT_FILE = /\.(?:ts|tsx|mts|cts)$/i;
const DECLARATION_FILE = /\.d\.(?:ts|mts|cts)$/i;
/** Nodes whose whole subtree is a type: a name used only inside them is no value use. */
const TYPE_POSITIONS = new Set([
  "TSTypeAnnotation", "TSTypeReference", "TSTypeQuery", "TSTypeParameterInstantiation", "TSTypeParameterDeclaration",
  "TSInterfaceDeclaration", "TSTypeAliasDeclaration", "TSExpressionWithTypeArguments", "TSClassImplements",
  "TSInterfaceHeritage", "TSDeclareFunction", "TSDeclareMethod", "TSIndexSignature", "TSPropertySignature", "TSMethodSignature",
]);

/** `import type`, `import typeof` (Flow), `export type`, or one such specifier. */
function isTypeOnly(node: ASTNode): boolean {
  return node.attributes.importKind === "type" || node.attributes.importKind === "typeof" || node.attributes.exportKind === "type";
}

/**
 * The names a TypeScript file uses as values: identifiers (JSX ones included) outside imports and type positions.
 * Undefined when the file has a decorator, since compilers that emit decorator metadata keep type imports too.
 * Over-counting is safe: a name counted by mistake only keeps an import as a load.
 */
function valueNames(root: ASTNode): ReadonlySet<string> | undefined {
  const names = new Set<string>();
  let decorated = false;
  const visit = (node: ASTNode): void => {
    if (node.type === "ImportDeclaration" || TYPE_POSITIONS.has(node.type) || isTypeOnly(node)) return;
    if (node.type === "Decorator") decorated = true;
    const name = node.attributes.name;
    if ((node.type === "Identifier" || node.type === "JSXIdentifier") && typeof name === "string") names.add(name);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return decorated ? undefined : names;
}

/** Whether an import declaration loads its module at run time; `values` is undefined when no import is elided. */
function importLoads(node: ASTNode, values: ReadonlySet<string> | undefined): boolean {
  if (isTypeOnly(node)) return false;
  const specifiers = node.children.filter((child) => child.role === "specifiers");
  if (values === undefined || specifiers.length === 0) return true;
  return specifiers.some((specifier) => {
    const local = specifier.children.find((child) => child.role === "local")?.attributes.name;
    return !isTypeOnly(specifier) && (typeof local !== "string" || values.has(local));
  });
}

/** Whether an `export … from` loads its module: not `export type`, and not only type specifiers. */
function reexportLoads(node: ASTNode): boolean {
  if (isTypeOnly(node)) return false;
  const specifiers = node.children.filter((child) => child.role === "specifiers");
  return specifiers.length === 0 || specifiers.some((specifier) => !isTypeOnly(specifier));
}

function stringValue(node: ASTNode | undefined): string | undefined {
  const value = node?.type === "StringLiteral" ? node.attributes.value : undefined;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isModuleExports(node: ASTNode | undefined): boolean {
  if (node?.type !== "MemberExpression" || node.attributes.computed === true) return false;
  const object = node.children.find((child) => child.role === "object");
  const property = node.children.find((child) => child.role === "property");
  return object?.type === "Identifier" && object.attributes.name === "module" && property?.type === "Identifier" && property.attributes.name === "exports";
}

export function collectLoadTimeModuleFacts(ast: ASTResult): LoadTimeModuleFacts {
  const filePath = canonicalizePath(ast.metadata.sourcePath);
  // A declaration file has no run-time code.
  if (DECLARATION_FILE.test(filePath)) return { filePath, loads: [], exportsReplacedAt: [] };
  const values = TYPESCRIPT_FILE.test(filePath) ? valueNames(ast.root) : undefined;
  const loads: { specifier: string; at: SourcePoint }[] = [];
  const exportsReplacedAt: SourcePoint[] = [];
  const visit = (node: ASTNode): void => {
    if (CALLABLE.has(node.type)) return;
    const at = node.location?.start ?? BEFORE_BODY;
    const loadsModule = node.type === "ImportDeclaration" ? importLoads(node, values)
      : node.type === "ExportAllDeclaration" || node.type === "ExportNamedDeclaration" ? reexportLoads(node) : false;
    if (loadsModule) {
      const specifier = stringValue(node.children.find((child) => child.role === "source"));
      if (specifier !== undefined) loads.push({ specifier, at: BEFORE_BODY });
    }
    if (node.type === "TSImportEqualsDeclaration" && !isTypeOnly(node)) {
      // `import x = require("x")` compiles to a `require` at this statement.
      const reference = node.children.find((child) => child.role === "moduleReference");
      const specifier = reference?.type === "TSExternalModuleReference" ? stringValue(reference.children.find((child) => child.role === "expression")) : undefined;
      if (specifier !== undefined) loads.push({ specifier, at });
    }
    if (node.type === "CallExpression") {
      const callee = node.children.find((child) => child.role === "callee");
      const args = node.children.filter((child) => child.role === "arguments");
      const specifier = callee?.type === "Identifier" && callee.attributes.name === "require" && args.length === 1 ? stringValue(args[0]) : undefined;
      if (specifier !== undefined) loads.push({ specifier, at });
    }
    if (node.type === "AssignmentExpression" && isModuleExports(node.children.find((child) => child.role === "left"))) exportsReplacedAt.push(at);
    for (const child of node.children) visit(child);
  };
  visit(ast.root);
  return { filePath, loads, exportsReplacedAt };
}

function before(left: SourcePoint, right: SourcePoint): boolean {
  return left.line < right.line || (left.line === right.line && left.column < right.column);
}

/**
 * The require cycles of a run: each file that is part of one, mapped to the files of its cycle (a strongly connected
 * component of the load-time edges with more than one file, or a file that loads itself).
 */
export function requireCycles(facts: readonly LoadTimeModuleFacts[], resolve: (importer: string, specifier: string) => string | undefined): ReadonlyMap<string, ReadonlySet<string>> {
  const edges = new Map<string, string[]>();
  for (const file of facts) {
    const targets = new Set<string>();
    for (const load of file.loads) {
      const target = resolve(file.filePath, load.specifier);
      if (target !== undefined) targets.add(target);
    }
    edges.set(file.filePath, [...targets].sort());
  }
  // Tarjan's algorithm, iterative so a deep import chain cannot overflow the stack.
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles = new Map<string, ReadonlySet<string>>();
  let counter = 0;
  for (const root of [...edges.keys()].sort()) {
    if (index.has(root)) continue;
    const work: { node: string; next: number }[] = [{ node: root, next: 0 }];
    index.set(root, counter); low.set(root, counter); counter++; stack.push(root); onStack.add(root);
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const targets = edges.get(frame.node) ?? [];
      if (frame.next < targets.length) {
        const target = targets[frame.next++]!;
        if (!edges.has(target)) continue;
        if (!index.has(target)) {
          index.set(target, counter); low.set(target, counter); counter++; stack.push(target); onStack.add(target);
          work.push({ node: target, next: 0 });
        } else if (onStack.has(target)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, index.get(target)!));
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent !== undefined) low.set(parent.node, Math.min(low.get(parent.node)!, low.get(frame.node)!));
      if (low.get(frame.node) !== index.get(frame.node)) continue;
      const members: string[] = [];
      let member: string | undefined;
      do { member = stack.pop()!; onStack.delete(member); members.push(member); } while (member !== frame.node);
      const selfLoop = members.length === 1 && (edges.get(frame.node) ?? []).includes(frame.node);
      if (members.length > 1 || selfLoop) {
        const cycle = new Set(members);
        for (const file of members) cycles.set(file, cycle);
      }
    }
  }
  return cycles;
}

/**
 * Files whose exports a module of their cycle may hold stale: the file replaces `module.exports` after a load-time
 * `require` of a file in its own cycle, so that file may have bound the object being replaced.
 */
export function staleExportFiles(facts: readonly LoadTimeModuleFacts[], cycles: ReadonlyMap<string, ReadonlySet<string>>, resolve: (importer: string, specifier: string) => string | undefined): ReadonlySet<string> {
  const stale = new Set<string>();
  for (const file of facts) {
    const cycle = cycles.get(file.filePath);
    if (cycle === undefined || file.exportsReplacedAt.length === 0) continue;
    const intoCycle = file.loads.filter((load) => {
      const target = resolve(file.filePath, load.specifier);
      return target !== undefined && cycle.has(target);
    });
    if (intoCycle.some((load) => file.exportsReplacedAt.some((replaced) => before(load.at, replaced)))) stale.add(file.filePath);
  }
  return stale;
}
