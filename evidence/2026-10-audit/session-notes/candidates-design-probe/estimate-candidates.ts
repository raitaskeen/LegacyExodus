// Measurement instrument (scratch only; NOT a candidate implementation). Estimates what the
// proposed CANDIDATES rules (design R1-R4) would emit for calls that the F-002 engine leaves
// UNRESOLVED, so the design can report recovered information before anything is built.
// It is intentionally simpler than the specified algorithm where noted (see LIMITS below).
//   bun estimate-candidates.ts <engineRoot> <corpusPath> <base.json> <f002.json> <label> [--list]
// LIMITS: scope resolution is name-within-declaring-subtree, not the builder's ScopeFrame model;
// class escape = exported/export-referenced/module.exports only; computed writes only reported.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [engineRoot, corpusPath, baseFile, candFile, label, flag] = process.argv.slice(2);
if (!engineRoot || !corpusPath || !baseFile || !candFile || !label) throw new Error("usage");
const src = (p: string) => resolve(engineRoot, "src", p);
const { JavaScriptParser, ParserManager, ParserRegistry } = await import(src("parser/index.ts"));
const { JavaScriptSymbolExtractor } = await import(src("symbols/index.ts"));
const { DeterministicDependencyGraphBuilder, ModuleResolver, canonicalizePath } = await import(src("graph/index.ts"));
const { DiscoveryEngine } = await import(src("discovery/index.ts"));

type Node = { type: string; role?: string; location?: { start: { line: number; column: number }; end: { line: number; column: number } }; attributes: Record<string, unknown>; children: Node[] };
type Sym = any;

const base = JSON.parse(await readFile(baseFile, "utf8"));
const cand = JSON.parse(await readFile(candFile, "utf8"));
const baseById = new Map<string, any>(base.calls.map((c: any) => [c.id, c]));

// ---- parse everything (offline; the product's pass 2 would use symbol tables instead) ----
const projectPath = resolve(corpusPath);
const discovery = await new DiscoveryEngine().discover({ projectId: "00000000-0000-4000-8000-000000000001", projectPath });
const registry = new ParserRegistry(); registry.register(new JavaScriptParser());
const pm = new ParserManager(registry); const extractor = new JavaScriptSymbolExtractor();
const astByPath = new Map<string, any>(); const tables: any[] = [];
for (const file of discovery.files) {
  if (file.language !== "javascript" && file.language !== "typescript") continue;
  try { const ast = await pm.parse({ file, source: await readFile(resolve(projectPath, file.path), "utf8") }); if (ast.errors.length) continue; astByPath.set(file.path, ast); tables.push(extractor.extract(ast)); } catch {}
}
let aliases = {};
try { const ts = JSON.parse(await readFile(resolve(projectPath, "tsconfig.json"), "utf8")); aliases = { ...(ts.compilerOptions?.baseUrl ? { baseUrl: ts.compilerOptions.baseUrl } : {}), ...(ts.compilerOptions?.paths ? { paths: ts.compilerOptions.paths } : {}) }; } catch {}
const graph = new DeterministicDependencyGraphBuilder(new ModuleResolver(aliases)).build(tables, discovery.files);
const targetByImport = new Map<string, string>(graph.edges.map((e: any) => [e.importSymbolId, e.targetExportSymbolId]));
const symById = new Map<string, Sym>(); const symsByFile = new Map<string, Sym[]>();
for (const t of tables) { symsByFile.set(t.filePath, t.symbols); for (const s of t.symbols) symById.set(s.id, s); }
const allSyms = [...symById.values()];

const id = (n: Node | undefined): string | undefined => typeof n?.attributes.name === "string" ? n.attributes.name as string : undefined;
const child = (n: Node, role: string) => n.children.find((c) => c.role === role);
const at = (n: Node | undefined) => n?.location ? `${n.location.start.line}:${n.location.start.column}` : "";
function memberPath(n: Node | undefined): string | undefined {
  if (!n) return undefined;
  if (n.type === "Identifier") return id(n);
  if (n.type === "ThisExpression") return "this";
  if ((n.type === "MemberExpression" || n.type === "OptionalMemberExpression") && n.attributes.computed !== true) {
    const o = memberPath(child(n, "object")); const p = id(child(n, "property")) ?? (child(n, "property")?.type === "PrivateName" ? `#${id(child(n, "property"))}` : undefined);
    return o && p ? `${o}.${p}` : undefined;
  }
  return undefined;
}

// ---- class graph: class node -> symbol, superclass edges (in-file = H1, cross-file = H2) ----
interface ClassInfo { sym: Sym; file: string; node: Node; superRef?: Node; superClassId?: string; superKind: "none" | "in-file" | "cross-file" | "unresolved"; methods: Map<string, { sym?: Sym; isStatic: boolean; kind: string }[]>; fieldNames: Map<string, Node | undefined>; }
const classes = new Map<string, ClassInfo>();
const classByFileName = new Map<string, Sym[]>();
for (const [path, syms] of symsByFile) for (const s of syms) if (s.kind === "class") { const k = `${path}\0${s.name}`; classByFileName.set(k, [...(classByFileName.get(k) ?? []), s]); }
for (const [path, ast] of astByPath) {
  const syms = symsByFile.get(path) ?? [];
  const visit = (n: Node) => {
    if (n.type === "ClassDeclaration" || n.type === "ClassExpression") {
      const sym = syms.find((s: Sym) => s.kind === "class" && s.location?.start.line === n.location?.start.line && s.location?.start.column === n.location?.start.column);
      if (sym) {
        const info: ClassInfo = { sym, file: path, node: n, superRef: child(n, "superClass"), superKind: "none", methods: new Map(), fieldNames: new Map() };
        const body = child(n, "body");
        for (const el of body?.children ?? []) {
          const name = el.type === "ClassPrivateMethod" || el.type === "ClassPrivateProperty" ? (id(child(el, "key")) ? `#${id(child(el, "key"))}` : undefined) : id(child(el, "key"));
          if (!name || el.attributes.computed === true) continue;
          if (el.type === "ClassMethod" || el.type === "ClassPrivateMethod") {
            const msym = syms.find((s: Sym) => s.kind === "method" && s.containerId === sym.id && s.name === name.replace(/^#/, "") && s.location?.start.line === el.location?.start.line) ?? syms.find((s: Sym) => s.kind === "method" && s.containerId === sym.id && (s.name === name || `#${s.name}` === name) && s.location?.start.line === el.location?.start.line);
            info.methods.set(name, [...(info.methods.get(name) ?? []), { sym: msym, isStatic: el.attributes.static === true, kind: String(el.attributes.kind ?? "method") }]);
          } else if (["ClassProperty", "ClassPrivateProperty", "PropertyDefinition", "ClassAccessorProperty"].includes(el.type)) {
            info.fieldNames.set(name, child(el, "value"));
          }
        }
        classes.set(sym.id, info);
      }
    }
    for (const c of n.children) visit(c);
  };
  visit(ast.root);
}
function resolveClassName(name: string, file: string, crossFile: boolean): { id?: string; kind: ClassInfo["superKind"] } {
  const local = classByFileName.get(`${file}\0${name}`) ?? [];
  if (local.length === 1) return { id: local[0].id, kind: "in-file" };
  if (!crossFile) return { kind: "unresolved" };
  const imp = (symsByFile.get(file) ?? []).find((s: Sym) => s.kind === "import" && s.name === name);
  const exportId = imp ? targetByImport.get(imp.id) : undefined;
  const exp = exportId ? symById.get(exportId) : undefined;
  if (exp) {
    const localName = exp.kind === "class" ? exp.name : (exp.sourceSymbolName ?? exp.name);
    const target = exp.kind === "class" ? [exp] : classByFileName.get(`${exp.filePath}\0${localName}`) ?? [];
    if (target.length === 1) return { id: target[0].id, kind: "cross-file" };
  }
  return { kind: "unresolved" };
}
function hierarchyEdges(crossFile: boolean): { superOf: Map<string, string | null>; subsOf: Map<string, string[]> } {
  const superOf = new Map<string, string | null>(); const subsOf = new Map<string, string[]>();
  for (const [cid, info] of classes) {
    if (!info.superRef) { superOf.set(cid, null); continue; }
    const r = info.superRef.type === "Identifier" ? resolveClassName(id(info.superRef)!, info.file, crossFile) : { kind: "unresolved" as const };
    if (r.id) { superOf.set(cid, r.id); subsOf.set(r.id, [...(subsOf.get(r.id) ?? []), cid]); } else superOf.set(cid, "UNRESOLVED");
  }
  return { superOf, subsOf };
}
const H = { h1: hierarchyEdges(false), h2: hierarchyEdges(true) };

// Global facts used for openWorld reasons.
const exportedNames = new Map<string, Set<string>>();
for (const [path, syms] of symsByFile) exportedNames.set(path, new Set(syms.filter((s: Sym) => s.kind === "export").flatMap((s: Sym) => [s.name, s.sourceSymbolName].filter(Boolean))));
const memberWriteNames = new Set(allSyms.filter((s: Sym) => s.containerName !== undefined && s.containerId === undefined && s.containerName !== "module.exports" && s.containerName !== "exports").map((s: Sym) => s.name));
const prototypeRefs = new Set<string>();
for (const ast of astByPath.values()) { const v = (n: Node) => { const p = memberPath(n); if (p && /\.prototype$/.test(p)) prototypeRefs.add(p.replace(/\.prototype$/, "")); n.children.forEach(v); }; v(ast.root); }

// Non-call member reads per file (`x.m` used as a value): a borrowed method may run with a foreign `this`.
const valueReadsByFile = new Map<string, Set<string>>();
for (const [path, ast] of astByPath) {
  const set = new Set<string>();
  const v = (n: Node, parent?: Node) => {
    if ((n.type === "MemberExpression" || n.type === "OptionalMemberExpression") && n.attributes.computed !== true
      && !(parent && (parent.type === "CallExpression" || parent.type === "OptionalCallExpression") && n.role === "callee")
      && !(parent?.type === "AssignmentExpression" && n.role === "left")) { const p = id(child(n, "property")); if (p) set.add(p); }
    n.children.forEach((c) => v(c, n));
  };
  v(ast.root); valueReadsByFile.set(path, set);
}
function classEscapes(info: ClassInfo): boolean { return info.sym.exported === true || (exportedNames.get(info.file)?.has(info.sym.name) ?? false); }

// R1: this.m() in class K. Runtime receiver classes = K and its subclasses.
function r1(classId: string, m: string, isStatic: boolean, variant: "h1" | "h2") {
  const { superOf, subsOf } = H[variant];
  const reasons = new Set<string>(); const out = new Set<string>();
  const closure: string[] = []; const stack = [classId];
  while (stack.length) { const c = stack.pop()!; if (closure.includes(c)) continue; closure.push(c); stack.push(...(subsOf.get(c) ?? [])); }
  for (const d of closure) {
    let c: string | null | undefined = d; let found = false; const seen = new Set<string>();
    while (c && c !== "UNRESOLVED" && !seen.has(c)) {
      seen.add(c); const info = classes.get(c)!;
      const decls = (info.methods.get(m) ?? []).filter((x) => x.isStatic === isStatic && x.kind !== "constructor");
      if (!isStatic && info.fieldNames.has(m)) { reasons.add("instance-field"); found = true; const v = info.fieldNames.get(m); const fs = v && (v.type === "ArrowFunctionExpression" || v.type === "FunctionExpression") ? (symsByFile.get(info.file) ?? []).filter((s: Sym) => (s.kind === "function" || s.kind === "method") && s.location?.start.line === v.location?.start.line && s.location?.start.column === v.location?.start.column) : []; fs.forEach((s: Sym) => out.add(s.id)); if (fs.length === 0) reasons.add("unknown-field-value"); break; }
      if (decls.length) { decls.forEach((x) => x.sym ? out.add(x.sym.id) : reasons.add("accessor-or-unindexed")); found = true; break; }
      c = superOf.get(c);
    }
    if (!found && c === "UNRESOLVED") reasons.add("unresolved-superclass");
  }
  for (const d of closure) { const info = classes.get(d)!; if (classEscapes(info)) reasons.add("exported-class"); if (prototypeRefs.has(info.sym.name)) reasons.add("prototype-access"); if (valueReadsByFile.get(info.file)?.has(m)) reasons.add("method-value-read"); }
  if (memberWriteNames.has(m)) reasons.add("untracked-property-write");
  return { basis: "class-hierarchy", candidates: [...out].sort(), openWorld: reasons.size > 0, reasons: [...reasons].sort() };
}

// R2: this.m() in a function stored on container X: the container's declared member m.
function r2(file: string, container: string, m: string) {
  const alias = container === "exports" ? ["exports", "module.exports"] : container === "module.exports" ? ["module.exports", "exports"] : [container];
  const out = (symsByFile.get(file) ?? []).filter((s: Sym) => (s.kind === "method" || s.kind === "function") && s.name === m && alias.includes(s.containerName) && s.containerId === undefined).map((s: Sym) => s.id);
  return { basis: "container-membership", candidates: [...new Set<string>(out)].sort(), openWorld: true, reasons: ["container-this-untracked"] };
}

// Binding-write collection for R3/R4 (estimator approximation of BindingWrites).
interface Decl { scopeNode: Node; kind: "param" | "var" | "let" | "const" | "function" | "class" | "import" | "catch"; declNode: Node; init?: Node }
function findDeclaration(path: Node[], name: string): Decl | undefined {
  for (let i = path.length - 1; i >= 0; i--) {
    const scope = path[i]!;
    const isFn = ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ClassMethod", "ClassPrivateMethod", "ObjectMethod"].includes(scope.type);
    if (isFn) for (const p of scope.children.filter((c) => c.role === "params" || c.role === "param")) if (boundNames(p).includes(name)) return { scopeNode: scope, kind: "param", declNode: p };
    if (scope.type === "CatchClause" && boundNames(child(scope, "param")).includes(name)) return { scopeNode: scope, kind: "catch", declNode: scope };
    const stmts = scope.type === "Program" || scope.type === "File" ? scope.children : scope.type === "BlockStatement" ? scope.children : isFn ? (child(scope, "body")?.children ?? []) : [];
    const found = searchDecl(stmts, name, isFn || scope.type === "Program");
    if (found) return { scopeNode: isFn ? scope : scope, ...found };
  }
  return undefined;
}
function searchDecl(nodes: Node[], name: string, hoistVar: boolean): Omit<Decl, "scopeNode"> | undefined {
  for (const n of nodes) {
    if (n.type === "VariableDeclaration") for (const d of n.children.filter((c) => c.type === "VariableDeclarator")) if (boundNames(child(d, "id")).includes(name)) return { kind: n.attributes.kind as any, declNode: d, init: child(d, "init") };
    if ((n.type === "FunctionDeclaration" || n.type === "ClassDeclaration") && id(child(n, "id")) === name) return { kind: n.type === "FunctionDeclaration" ? "function" : "class", declNode: n };
    if (n.type === "ImportDeclaration" && n.children.some((s) => id(child(s, "local")) === name)) return { kind: "import", declNode: n };
    if (n.type === "ExportNamedDeclaration" || n.type === "ExportDefaultDeclaration") { const r = searchDecl(n.children, name, hoistVar); if (r) return r; }
    if (hoistVar && !["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ClassDeclaration", "ClassExpression"].includes(n.type) && n.type !== "VariableDeclaration") {
      const r = searchVarDeep(n, name); if (r) return r;
    }
  }
  return undefined;
}
function searchVarDeep(n: Node, name: string): Omit<Decl, "scopeNode"> | undefined {
  if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ClassMethod", "ObjectMethod"].includes(n.type)) return undefined;
  if (n.type === "VariableDeclaration" && n.attributes.kind === "var") for (const d of n.children.filter((c) => c.type === "VariableDeclarator")) if (boundNames(child(d, "id")).includes(name)) return { kind: "var", declNode: d, init: child(d, "init") };
  for (const c of n.children) { const r = searchVarDeep(c, name); if (r) return r; }
  return undefined;
}
function boundNames(n: Node | undefined): string[] {
  if (!n) return [];
  if (n.type === "Identifier") return id(n) ? [id(n)!] : [];
  if (n.type === "AssignmentPattern") return boundNames(child(n, "left"));
  if (n.type === "RestElement") return boundNames(child(n, "argument"));
  if (n.type === "ObjectPattern") return n.children.flatMap((c) => c.type === "RestElement" ? boundNames(c) : boundNames(child(c, "value") ?? child(c, "key")));
  if (n.type === "ArrayPattern") return n.children.flatMap(boundNames);
  if (n.type === "TSParameterProperty") return boundNames(child(n, "parameter"));
  return [];
}
// All `name = v` writes inside the declaring scope subtree that are not shadowed (approximate: no re-declaration check).
function bindingWrites(scope: Node, name: string): Node[] {
  const values: Node[] = [];
  const v = (n: Node) => { if (n.type === "AssignmentExpression" && child(n, "left")?.type === "Identifier" && id(child(n, "left")) === name) values.push(n.attributes.operator === "=" ? child(n, "right")! : n); if (n.type === "UpdateExpression" && id(child(n, "argument")) === name) values.push(n); n.children.forEach(v); };
  v(scope); return values;
}
function valueTargets(file: string, value: Node | undefined): string[] | undefined {
  if (!value) return undefined;
  if (value.type === "ArrowFunctionExpression" || value.type === "FunctionExpression") {
    const fs = (symsByFile.get(file) ?? []).filter((s: Sym) => (s.kind === "function" || s.kind === "method") && s.location?.start.line === value.location?.start.line && s.location?.start.column === value.location?.start.column);
    return fs.length ? fs.map((s: Sym) => s.id) : undefined;
  }
  return undefined; // identifiers, calls, members: value unknown to this estimator (and to the R3 rule unless the source binding is itself proven)
}
function r3(file: string, decl: Decl, name: string) {
  const reasons = new Set<string>(); const out = new Set<string>();
  if (decl.kind === "param" || decl.kind === "catch") return undefined; // implicit write from callers: no value evidence
  if (decl.kind === "function" || decl.kind === "class") { const s = (symsByFile.get(file) ?? []).find((x: Sym) => x.kind === decl.kind && x.name === name && x.location?.start.line === decl.declNode.location?.start.line); if (s) out.add(s.id); else reasons.add("unindexed-declaration"); }
  else if (decl.kind === "import") { reasons.add("import-initial-value"); }
  else if (decl.init) { const t = valueTargets(file, decl.init); if (t) t.forEach((x) => out.add(x)); else reasons.add("unknown-write-value"); }
  for (const w of bindingWrites(decl.scopeNode, name)) { const t = valueTargets(file, w); if (t) t.forEach((x) => out.add(x)); else reasons.add("unknown-write-value"); }
  return { basis: "binding-writes", candidates: [...out].sort(), openWorld: reasons.size > 0, reasons: [...reasons].sort() };
}

// ---- walk each file once, evaluate every F-002 UNRESOLVED call ----
const unresolvedByFile = new Map<string, any[]>();
for (const c of cand.calls) if (c.resolutionState === "UNRESOLVED" && c.location) unresolvedByFile.set(c.sourceFilePath, [...(unresolvedByFile.get(c.sourceFilePath) ?? []), c]);
const results: any[] = []; let unmatched = 0;
for (const [file, calls] of unresolvedByFile) {
  const ast = astByPath.get(file); if (!ast) { unmatched += calls.length; continue; }
  const want = new Map<string, any[]>(); for (const c of calls) { const k = `${c.location.line}:${c.location.column}`; want.set(k, [...(want.get(k) ?? []), c]); }
  const visit = (n: Node, path: Node[]) => {
    if ((n.type === "CallExpression" || n.type === "OptionalCallExpression" || n.type === "NewExpression") && want.has(at(n))) {
      const callee = child(n, "callee"); const name = memberPath(callee);
      for (const c of want.get(at(n))!) if (c.calleeName === name) { results.push(evaluate(file, c, name!, n, path)); c.__matched = true; }
    }
    for (const ch of n.children) visit(ch, [...path, n]);
  };
  visit(ast.root, []);
  unmatched += calls.filter((c) => !c.__matched).length;
}
function thisBinder(path: Node[]): { node: Node; parent?: Node; index: number } | undefined {
  for (let i = path.length - 1; i >= 0; i--) { const n = path[i]!; if (n.type === "ArrowFunctionExpression") continue; if (["FunctionDeclaration", "FunctionExpression", "ClassMethod", "ClassPrivateMethod", "ObjectMethod", "StaticBlock"].includes(n.type) || ["ClassProperty", "ClassPrivateProperty", "PropertyDefinition"].includes(n.type)) return { node: n, parent: path[i - 1], index: i }; }
  return undefined;
}
function evaluate(file: string, call: any, name: string, node: Node, path: Node[]) {
  const parts = name.split("."); const baseCall = baseById.get(call.id);
  const row: any = { file, line: call.location.line, callee: name, wasResolved: baseCall?.resolutionState === "RESOLVED", baseTarget: baseCall?.targetSymbolId };
  if (parts.length === 2 && parts[0] === "this") {
    const b = thisBinder(path);
    if (b && (b.node.type.startsWith("Class"))) {
      const cls = [...path].reverse().find((n) => n.type === "ClassDeclaration" || n.type === "ClassExpression");
      const info = cls ? [...classes.values()].find((x) => x.node === cls) : undefined;
      if (info) { const isStatic = b.node.attributes.static === true; row.rule = "R1"; row.h1 = r1(info.sym.id, parts[1]!, isStatic, "h1"); row.h2 = r1(info.sym.id, parts[1]!, isStatic, "h2"); return row; }
    }
    if (b && b.node.type === "FunctionExpression" && b.parent?.type === "AssignmentExpression" && b.node.role === "right") {
      // Container is the assignment target's object, also for computed keys (`app[method] = function`).
      const left = child(b.parent, "left");
      const container = left && (left.type === "MemberExpression" || left.type === "OptionalMemberExpression") ? memberPath(child(left, "object")) : undefined;
      if (container) { row.rule = "R2"; row.h1 = row.h2 = r2(file, container, parts[1]!); return row; }
    }
    if (b && (b.node.type === "ObjectMethod" || (b.node.type === "FunctionExpression" && b.parent?.type === "ObjectProperty"))) {
      const objIdx = path.lastIndexOf(b.parent ?? b.node); const decl = path.slice(0, objIdx).reverse().find((n) => n.type === "VariableDeclarator");
      const container = decl ? id(child(decl, "id")) : undefined;
      if (container) { row.rule = "R2"; row.h1 = row.h2 = r2(file, container, parts[1]!); return row; }
    }
    row.rule = "this-no-evidence"; return row;
  }
  if (parts.length === 1) {
    const decl = findDeclaration(path, name);
    if (!decl) { row.rule = "free-name"; return row; }
    const r = r3(file, decl, name); row.rule = r ? "R3" : `R3-${decl.kind}-no-evidence`; if (r) row.h1 = row.h2 = r; return row;
  }
  if (parts.length === 2) {
    const decl = findDeclaration(path, parts[0]!);
    if (!decl || decl.kind === "param" || decl.kind === "catch" || decl.kind === "import") { row.rule = `R4-${decl?.kind ?? "free"}-no-evidence`; return row; }
    const members = (symsByFile.get(file) ?? []).filter((s: Sym) => (s.kind === "method" || s.kind === "function") && s.containerName === parts[0] && s.name === parts[1] && s.containerId === undefined).map((s: Sym) => s.id);
    row.rule = members.length ? "R4" : "R4-no-member"; if (members.length) row.h1 = row.h2 = { basis: "receiver-container", candidates: members, openWorld: true, reasons: ["container-aliasing-untracked"] }; return row;
  }
  row.rule = "deep-member"; return row;
}

// ---- metrics ----
const hist = (xs: number[]) => xs.reduce((m: Record<string, number>, x) => { const k = x >= 4 ? "4+" : String(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});
function summarize(rows: any[], v: "h1" | "h2") {
  const withC = rows.filter((r) => r[v]?.candidates.length > 0);
  const reasons: Record<string, number> = {}; for (const r of withC) for (const x of r[v].reasons) reasons[x] = (reasons[x] ?? 0) + 1;
  const lost = rows.filter((r) => r.wasResolved);
  const lostWithC = lost.filter((r) => r[v]?.candidates.length > 0);
  return {
    unresolvedEvaluated: rows.length,
    candidates: withC.length,
    byRule: withC.reduce((m: Record<string, number>, r) => { m[r.rule] = (m[r.rule] ?? 0) + 1; return m; }, {}),
    setSize: hist(withC.map((r) => r[v].candidates.length)),
    closedWorld: withC.filter((r) => !r[v].openWorld).length,
    openWorldReasons: reasons,
    f002Demoted: lost.length,
    demotedRecoveredAsCandidates: lostWithC.length,
    demotedStillUnresolvedByRule: lost.filter((r) => !(r[v]?.candidates.length > 0)).reduce((m: Record<string, number>, r) => { m[r.rule] = (m[r.rule] ?? 0) + 1; return m; }, {}),
    demotedBaselineTargetContained: lostWithC.filter((r) => r[v].candidates.includes(r.baseTarget)).length,
    demotedSingleton: lostWithC.filter((r) => r[v].candidates.length === 1).length,
  };
}
const report = { label, files: astByPath.size, classes: classes.size, unmatched, h1: summarize(results, "h1"), h2: summarize(results, "h2") };
console.log(JSON.stringify(report, null, 1));
await writeFile(`estimate-${label}.json`, JSON.stringify({ report, rows: results }));
if (flag === "--list") for (const r of results.filter((r) => r.wasResolved || r.h2?.candidates.length > 1)) console.log(`${r.rule}\t${r.file}:${r.line}\t${r.callee}\twas=${r.wasResolved}\th2=${r.h2 ? r.h2.candidates.map((x: string) => { const s = symById.get(x); return `${s?.containerName ?? classes.get(s?.containerId)?.sym.name ?? ""}.${s?.name}@${s?.filePath}:${s?.location?.start.line}`; }).join(",") : "-"}\topen=${r.h2?.openWorld}\t${r.h2?.reasons?.join("|") ?? ""}`);
