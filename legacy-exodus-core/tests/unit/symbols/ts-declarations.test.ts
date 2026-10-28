import { describe, expect, it } from "bun:test";

import { DeterministicDependencyGraphBuilder } from "@graph/dependency-graph-builder";
import { JavaScriptParser } from "@parser/adapters/javascript/javascript-parser";
import { DeterministicSemanticAnalysisEngine } from "@semantic/semantic-engine";
import { JavaScriptSymbolExtractor } from "@symbols/javascript-symbol-extractor";
import type { CodeSymbol, SymbolTable } from "@symbols/index";

/**
 * BA-02: TypeScript declaration nodes must yield symbols, namespaces must scope their members and
 * must never leak them as module exports, and `import x = require()` / `export =` must behave like
 * their CommonJS counterparts.
 */

const parser = new JavaScriptParser();
const extractor = new JavaScriptSymbolExtractor();

function fileOf(path: string, source: string) {
  return { id: `file:${path}`, path, language: "typescript", size: source.length };
}

async function parseFile(path: string, source: string) {
  return (await parser.parse({ file: fileOf(path, source), source })).result;
}

async function extract(source: string, path = "src/defs.ts"): Promise<SymbolTable> {
  return extractor.extract(await parseFile(path, source));
}

function ofKind(table: SymbolTable, kind: string, name?: string): CodeSymbol[] {
  return table.symbols.filter((symbol) => (symbol.kind as string) === kind && (name === undefined || symbol.name === name));
}

function one(table: SymbolTable, kind: string, name: string): CodeSymbol | undefined {
  const matches = ofKind(table, kind, name);
  return matches.length === 1 ? matches[0] : undefined;
}

const moduleExportNames = (table: SymbolTable): string[] => ofKind(table, "export").map((symbol) => symbol.name);

describe("BA-02 enums, interfaces and type aliases", () => {
  it("an enum is a symbol of its own kind; its members are not symbols", async () => {
    const table = await extract([
      "export enum Color { Red, Green }",
      "export const enum Dir { Up }",
      "enum Local { A }",
      "declare enum Ambient { B }",
    ].join("\n"));

    for (const [name, exported] of [["Color", true], ["Dir", true], ["Local", false], ["Ambient", false]] as const) {
      const symbol = one(table, "enum", name);
      expect(symbol?.exported).toBe(exported);
      expect(symbol?.scopeId).toBe("scope:module");
      expect(symbol?.containerName).toBeUndefined();
    }
    expect(moduleExportNames(table)).toEqual(["Color", "Dir"]);
    for (const member of ["Red", "Green", "Up", "A", "B"]) expect(table.symbols.some((symbol) => symbol.name === member)).toBe(false);
  });

  it("interfaces and type aliases are symbols of their own kinds; members are not symbols", async () => {
    const table = await extract([
      "export interface Shape { area(): number; side: number }",
      "export type Id = string;",
      "interface Hidden { h: number }",
      "type Alias = number;",
    ].join("\n"));

    expect(one(table, "interface", "Shape")?.exported).toBe(true);
    expect(one(table, "type-alias", "Id")?.exported).toBe(true);
    expect(one(table, "interface", "Hidden")?.exported).toBe(false);
    expect(one(table, "type-alias", "Alias")?.exported).toBe(false);
    expect(moduleExportNames(table)).toEqual(["Shape", "Id"]);
    for (const member of ["area", "side", "h"]) expect(table.symbols.some((symbol) => symbol.name === member)).toBe(false);
  });

  it("export default interface is a default export of the interface", async () => {
    const table = await extract("export default interface Config { port: number }\n");

    const declaration = one(table, "interface", "Config");
    expect(declaration?.exported).toBe(true);
    expect(declaration?.defaultExport).toBe(true);
    const exported = ofKind(table, "export");
    expect(exported).toHaveLength(1);
    expect(exported[0]).toMatchObject({ name: "default", defaultExport: true, sourceSymbolName: "Config" });
  });

  it("export specifiers mark local enums, interfaces and type aliases exported", async () => {
    const table = await extract([
      "enum Color { Red }",
      "interface Shape { a: number }",
      "type Id = string;",
      "namespace NS { export const x = 1; }",
      "export { Color, NS as Space };",
      "export type { Shape, Id };",
    ].join("\n"));

    expect(one(table, "enum", "Color")?.exported).toBe(true);
    expect(one(table, "interface", "Shape")?.exported).toBe(true);
    expect(one(table, "type-alias", "Id")?.exported).toBe(true);
    expect(one(table, "namespace", "NS")?.exported).toBe(true);
    expect(moduleExportNames(table).sort()).toEqual(["Color", "Id", "Shape", "Space"]);
  });

  it("merged declarations yield one declaration symbol each but a single export symbol per name", async () => {
    const table = await extract([
      "export interface Shape { a: number }",
      "export interface Shape { b: number }",
      "export enum Mode { A }",
      "export namespace Mode { export const x = 1; }",
    ].join("\n"));

    expect(ofKind(table, "interface", "Shape")).toHaveLength(2);
    expect(new Set(ofKind(table, "interface", "Shape").map((symbol) => symbol.id)).size).toBe(2);
    expect(ofKind(table, "enum", "Mode")).toHaveLength(1);
    expect(ofKind(table, "namespace", "Mode")).toHaveLength(1);
    expect(moduleExportNames(table)).toEqual(["Shape", "Mode"]);
  });

  it("a type merged with a value keeps the value's export symbol, whatever the order", async () => {
    const valueFirst = await extract("export const Foo = 1;\nexport type Foo = number;\nexport interface Bar { a: 1 }\nexport function Bar() {}\n");
    const typeFirst = await extract("export type Foo = number;\nexport const Foo = 1;\nexport function Bar() {}\nexport interface Bar { a: 1 }\n");

    for (const table of [valueFirst, typeFirst]) {
      expect(moduleExportNames(table).sort()).toEqual(["Bar", "Foo"]);
      expect(ofKind(table, "type-alias", "Foo")[0]?.exported).toBe(true);
      expect(ofKind(table, "interface", "Bar")[0]?.exported).toBe(true);
    }
    // The export symbol stays anchored at the value declaration, exactly as before types had symbols.
    const foo = ofKind(valueFirst, "export", "Foo")[0]!;
    expect(foo.location?.start).toEqual({ line: 1, column: 0 });
    const typeFirstFoo = ofKind(typeFirst, "export", "Foo")[0]!;
    expect(typeFirstFoo.location?.start).toEqual({ line: 2, column: 0 });
  });
});

describe("BA-02 declare function and overloads", () => {
  it("declare function yields a function symbol with its parameters", async () => {
    const table = await extract("declare function d(a: number, b?: string): void;\nexport declare function external(): void;\n");

    expect(one(table, "function", "d")).toMatchObject({ exported: false, parameters: ["a", "b"], scopeId: "scope:module" });
    expect(one(table, "function", "external")?.exported).toBe(true);
    expect(moduleExportNames(table)).toEqual(["external"]);
  });

  it("overload signatures and their implementation yield one function symbol: the implementation", async () => {
    const table = await extract([
      "function ov(a: string): void;",
      "function ov(a: number): void;",
      "function ov(a: any): void {}",
    ].join("\n"));

    const functions = ofKind(table, "function", "ov");
    expect(functions).toHaveLength(1);
    expect(functions[0]?.location?.start).toEqual({ line: 3, column: 0 });
    // Nothing but the implementation has a body, so only it owns a parameter symbol.
    expect(ofKind(table, "variable", "a")).toHaveLength(1);
  });

  it("exported overloads yield one function symbol and one export symbol, both the implementation's", async () => {
    const table = await extract([
      "export function ov(a: string): string;",
      "export function ov(a: number): number;",
      "export function ov(a: any): any { return a; }",
    ].join("\n"));

    const functions = ofKind(table, "function", "ov");
    expect(functions).toHaveLength(1);
    expect(functions[0]).toMatchObject({ exported: true, location: { start: { line: 3, column: 7 } } });
    const exports = ofKind(table, "export", "ov");
    expect(exports).toHaveLength(1);
    expect(exports[0]?.location?.start).toEqual({ line: 3, column: 0 });
  });

  it("signature-only overloads yield one function symbol: the first signature", async () => {
    const table = await extract([
      "export declare function ov(a: string): string;",
      "export declare function ov(a: number): number;",
    ].join("\n"));

    const functions = ofKind(table, "function", "ov");
    expect(functions).toHaveLength(1);
    expect(functions[0]?.location?.start).toEqual({ line: 1, column: 7 });
    const exports = ofKind(table, "export", "ov");
    expect(exports).toHaveLength(1);
    expect(exports[0]?.location?.start).toEqual({ line: 1, column: 0 });
  });

  it("the same overloaded name in different scopes is not merged", async () => {
    const table = await extract([
      "function ov(a: string): void;",
      "function ov(a: any): void {}",
      "namespace N {",
      "  export function ov(a: string): void;",
      "  export function ov(a: any): void {}",
      "}",
    ].join("\n"));

    const functions = ofKind(table, "function", "ov");
    expect(functions.map((symbol) => symbol.scopeId).sort()).toEqual(["scope:TSModuleDeclaration:3:0", "scope:module"]);
  });
});

describe("BA-02 namespaces and module declarations", () => {
  it("namespace members live in the namespace's own scope and never become module exports", async () => {
    const table = await extract([
      "export namespace NS {",
      "  export function f(): number { return 1; }",
      "  function hidden() {}",
      "  export const k = 1;",
      "  export class C {}",
      "  export interface I { a: 1 }",
      "}",
    ].join("\n"));

    const namespace = one(table, "namespace", "NS");
    expect(namespace).toMatchObject({ exported: true, scopeId: "scope:module" });
    const scopeId = "scope:TSModuleDeclaration:1:7";
    for (const [kind, name, exported] of [["function", "f", true], ["function", "hidden", false], ["variable", "k", true], ["class", "C", true], ["interface", "I", true]] as const) {
      const member = one(table, kind, name);
      expect(member).toMatchObject({ scopeId, containerName: "NS", exported });
    }
    // The negative control: the nested `export` keyword exports from the namespace, not from the module.
    expect(moduleExportNames(table)).toEqual(["NS"]);
  });

  it("a namespace member does not collide with a module-level binding of the same name", async () => {
    const table = await extract([
      "function f() {}",
      "namespace NS { export function f() {} }",
    ].join("\n"));

    const functions = ofKind(table, "function", "f");
    expect(functions.map((symbol) => symbol.scopeId).sort()).toEqual(["scope:TSModuleDeclaration:2:0", "scope:module"]);
    expect(moduleExportNames(table)).toEqual([]);
    expect(functions.find((symbol) => symbol.scopeId === "scope:module")?.exported).toBe(false);
  });

  it("A.B.C declares the outer binding once and names the whole path as its members' container", async () => {
    const table = await extract("export namespace A.B.C { export function h() {} }\n");

    expect(ofKind(table, "namespace").map((symbol) => symbol.name)).toEqual(["A"]);
    expect(one(table, "function", "h")).toMatchObject({ containerName: "A.B.C", exported: true });
    expect(moduleExportNames(table)).toEqual(["A"]);
  });

  it("nested namespaces scope their members to the inner namespace", async () => {
    const table = await extract([
      "namespace Outer {",
      "  export namespace Inner { export const v = 1; }",
      "  export const o = 2;",
      "}",
    ].join("\n"));

    expect(one(table, "namespace", "Inner")).toMatchObject({ containerName: "Outer", exported: true, scopeId: "scope:TSModuleDeclaration:1:0" });
    expect(one(table, "variable", "v")).toMatchObject({ containerName: "Outer.Inner", scopeId: "scope:TSModuleDeclaration:2:9", exported: true });
    expect(one(table, "variable", "o")).toMatchObject({ containerName: "Outer", scopeId: "scope:TSModuleDeclaration:1:0" });
    expect(moduleExportNames(table)).toEqual([]);
  });

  it("declare module 'x' scopes its members to the module and exports nothing from the file", async () => {
    const table = await extract([
      "declare module 'x' {",
      "  export function g(): void;",
      "  export default function dflt(): void;",
      "  export * from 'y';",
      "  const a: number;",
      "  export { a };",
      "  interface Local { z: 1 }",
      "}",
    ].join("\n"), "types/ambient.d.ts");

    // The module is named by a string, so it declares no identifier binding.
    expect(ofKind(table, "namespace")).toEqual([]);
    expect(moduleExportNames(table)).toEqual([]);
    const scopeId = "scope:TSModuleDeclaration:1:0";
    expect(one(table, "function", "g")).toMatchObject({ scopeId, containerName: "x", exported: true });
    expect(one(table, "function", "dflt")).toMatchObject({ scopeId, containerName: "x", exported: true, defaultExport: true });
    expect(one(table, "variable", "a")).toMatchObject({ scopeId, containerName: "x", exported: true });
    expect(one(table, "interface", "Local")).toMatchObject({ scopeId, containerName: "x", exported: false });
  });

  it("an ambient namespace or module exports every member unless its body has an export declaration", async () => {
    const table = await extract([
      "export declare namespace Implicit { const a: number; function f(): void; export const b: number; }",
      "declare namespace Explicit { const kept: number; const hidden: number; export { kept }; }",
      "declare module 'implicit-module' { const m: number; }",
      "namespace Concrete { const hidden = 1; export const shown = 2; }",
    ].join("\n"), "src/ambient.ts");
    const declared = await extract("namespace InDts { const z: number; }\n", "types/in-dts.d.ts");

    const exportedIn = (container: string, name: string) => table.symbols.find((symbol) => symbol.name === name && symbol.containerName === container)?.exported;
    expect([exportedIn("Implicit", "a"), exportedIn("Implicit", "f"), exportedIn("Implicit", "b")]).toEqual([true, true, true]);
    // `export { kept }` is an export declaration: only what it or an `export` modifier names is exported.
    expect([exportedIn("Explicit", "kept"), exportedIn("Explicit", "hidden")]).toEqual([true, false]);
    expect(exportedIn("implicit-module", "m")).toBe(true);
    // Code that is not ambient exports only what it marks.
    expect([exportedIn("Concrete", "hidden"), exportedIn("Concrete", "shown")]).toEqual([false, true]);
    // A declaration file is ambient throughout.
    expect(one(declared, "variable", "z")?.exported).toBe(true);
    expect(moduleExportNames(table)).toEqual(["Implicit"]);
    expect(moduleExportNames(declared)).toEqual([]);
  });

  it("export = inside an ambient module exports from the module, not from the file", async () => {
    const table = await extract("declare module 'cjs' { class K {} export = K; }\n", "types/ambient.d.ts");

    expect(moduleExportNames(table)).toEqual([]);
    expect(one(table, "class", "K")).toMatchObject({ exported: true, containerName: "cjs", scopeId: "scope:TSModuleDeclaration:1:0" });
  });

  it("declare global creates a scope and exports nothing", async () => {
    const table = await extract([
      "export {};",
      "declare global {",
      "  interface Window { app: unknown }",
      "  function globalFn(): void;",
      "  var counter: number;",
      "}",
    ].join("\n"), "types/global.d.ts");

    expect(ofKind(table, "namespace")).toEqual([]);
    const scopeId = "scope:TSModuleDeclaration:2:0";
    expect(one(table, "interface", "Window")).toMatchObject({ scopeId, containerName: "global", exported: false });
    expect(one(table, "function", "globalFn")).toMatchObject({ scopeId, containerName: "global", exported: false });
    expect(one(table, "variable", "counter")).toMatchObject({ scopeId, exported: false });
    expect(moduleExportNames(table)).toEqual([]);
  });

  it("imports inside an ambient module keep their module reference", async () => {
    const table = await extract("declare module 'x' { import { T } from 'dep'; export function g(): T; }\n", "types/ambient.d.ts");

    expect(table.moduleReferences?.map((reference) => reference.moduleSpecifier)).toEqual(["dep"]);
    expect(moduleExportNames(table)).toEqual([]);
  });
});

describe("BA-02 import = require() and import = entity", () => {
  it("import x = require('m') is an import symbol and a commonjs-import module reference, like const x = require('m')", async () => {
    const source = 'import fs = require("fs");\n';
    const table = await extract(source, "src/legacy.ts");
    const cjs = await extract('const fs = require("fs");\n', "src/cjs.ts");

    const imported = one(table, "import", "fs")!;
    expect(imported).toMatchObject({ moduleSpecifier: "fs", defaultExport: true, exported: false, scopeId: "scope:module" });
    expect(imported.sourceSymbolName).toBeUndefined();
    expect(table.moduleReferences).toHaveLength(1);
    const reference = table.moduleReferences![0]!;
    expect(reference).toMatchObject({ moduleSpecifier: "fs", form: "commonjs-import", importSymbolIds: [imported.id] });
    expect(reference.sourceAnchor).toEqual({ kind: "offset", start: 0, end: source.trimEnd().length });

    // Parity with the CommonJS form it mirrors.
    const cjsImport = one(cjs, "import", "fs")!;
    const shape = (symbol: CodeSymbol) => ({
      kind: symbol.kind, name: symbol.name, moduleSpecifier: symbol.moduleSpecifier, sourceSymbolName: symbol.sourceSymbolName,
      defaultExport: symbol.defaultExport, exported: symbol.exported, scopeId: symbol.scopeId,
    });
    expect(shape(imported)).toEqual(shape(cjsImport));
    expect(cjs.moduleReferences![0]).toMatchObject({ moduleSpecifier: "fs", form: reference.form });
    expect(cjs.moduleReferences![0]!.sourceAnchor?.kind).toBe(reference.sourceAnchor?.kind);
  });

  it("import type x = require('m') is a type-phase reference", async () => {
    const table = await extract('import type T = require("types-pkg");\n', "src/legacy.ts");

    expect(one(table, "import", "T")).toMatchObject({ moduleSpecifier: "types-pkg", defaultExport: true });
    expect(table.moduleReferences?.[0]).toMatchObject({ moduleSpecifier: "types-pkg", form: "commonjs-import", sourcePhase: "type" });
  });

  it("import A = NS.B is a variable alias, not a module reference", async () => {
    const table = await extract("namespace NS { export const B = 1; }\nimport A = NS.B;\n", "src/alias.ts");

    expect(ofKind(table, "import")).toEqual([]);
    expect(table.moduleReferences).toEqual([]);
    expect(one(table, "variable", "A")).toMatchObject({ exported: false, scopeId: "scope:module", sourceSymbolName: "NS.B" });
    expect(moduleExportNames(table)).toEqual([]);
  });

  it("export import x = require('m') is both an import and an export of x", async () => {
    const table = await extract('export import x = require("m");\n', "src/reexport.ts");

    expect(one(table, "import", "x")).toMatchObject({ moduleSpecifier: "m", defaultExport: true });
    expect(table.moduleReferences?.map((reference) => [reference.moduleSpecifier, reference.form])).toEqual([["m", "commonjs-import"]]);
    const exports = ofKind(table, "export");
    expect(exports).toHaveLength(1);
    expect(exports[0]).toMatchObject({ name: "x", defaultExport: false });
    expect(exports[0]?.moduleSpecifier).toBeUndefined();
  });

  it("export import A = NS.B is a variable alias that is exported", async () => {
    const table = await extract("namespace NS { export const B = 1; }\nexport import A = NS.B;\n", "src/alias.ts");

    expect(one(table, "variable", "A")).toMatchObject({ exported: true, scopeId: "scope:module" });
    expect(moduleExportNames(table)).toEqual(["A"]);
    expect(table.moduleReferences).toEqual([]);
  });
});

describe("BA-02 export = expression", () => {
  it("export = x is a default export sourced from x, and x is exported", async () => {
    const table = await extract("const x = { a: 1 };\nexport = x;\n", "src/legacy.ts");

    const exports = ofKind(table, "export");
    expect(exports).toHaveLength(1);
    expect(exports[0]).toMatchObject({ name: "default", defaultExport: true, sourceSymbolName: "x" });
    expect(exports[0]?.moduleSpecifier).toBeUndefined();
    expect(one(table, "variable", "x")?.exported).toBe(true);
  });

  it("export = marks a class, function or namespace exported", async () => {
    for (const [declaration, kind, name] of [
      ["class Svc {}", "class", "Svc"],
      ["function fn() {}", "function", "fn"],
      ["namespace NS { export const v = 1; }", "namespace", "NS"],
    ] as const) {
      const table = await extract(`${declaration}\nexport = ${name};\n`, "src/legacy.ts");
      expect(one(table, kind, name)?.exported).toBe(true);
      expect(ofKind(table, "export")[0]).toMatchObject({ name: "default", defaultExport: true, sourceSymbolName: name });
    }
  });

  it("export = <expression> is a default export with no source symbol, and its functions still get parameters", async () => {
    const table = await extract("export = function (value: number) { return value; };\n", "src/legacy.ts");

    expect(ofKind(table, "export")).toHaveLength(1);
    expect(ofKind(table, "export")[0]).toMatchObject({ name: "default", defaultExport: true });
    expect(ofKind(table, "export")[0]?.sourceSymbolName).toBeUndefined();
    expect(one(table, "variable", "value")?.declarationKind).toBe("param");
  });
});

describe("BA-02 module and call graphs", () => {
  const builder = new DeterministicDependencyGraphBuilder();
  const engine = new DeterministicSemanticAnalysisEngine();

  async function analyze(sources: Readonly<Record<string, string>>) {
    const files = Object.entries(sources).map(([path, source]) => fileOf(path, source));
    const asts = await Promise.all(Object.entries(sources).map(([path, source]) => parseFile(path, source)));
    const tables = asts.map((ast) => extractor.extract(ast));
    const dependencyGraph = builder.build(tables, files);
    const analysis = engine.analyze({ astResults: asts, symbolTables: tables, dependencyGraph });
    return { tables, dependencyGraph, analysis };
  }

  it("importing an enum, namespace, interface or type alias resolves to its export symbol", async () => {
    const { tables, dependencyGraph } = await analyze({
      "src/defs.ts": [
        "export enum Color { Red }",
        "export namespace NS { export function f(): number { return 1; } }",
        "export interface Shape { area(): number }",
        "export type Id = string;",
        "export declare function external(): void;",
      ].join("\n"),
      "src/use.ts": [
        "import { Color, NS, external } from './defs';",
        "import type { Shape, Id } from './defs';",
        "const s: Shape | undefined = undefined; const i: Id = 'x';",
        "console.log(Color.Red, NS.f(), s, i);",
        "external();",
      ].join("\n"),
    });

    const [defs, use] = tables;
    for (const name of ["Color", "NS", "Shape", "Id", "external"]) {
      const exported = ofKind(defs!, "export", name)[0];
      const imported = ofKind(use!, "import", name)[0];
      expect(exported).toBeDefined();
      expect(imported).toBeDefined();
      const edge = dependencyGraph.edges.find((candidate) => candidate.importSymbolId === imported?.id);
      expect(edge?.targetExportSymbolId).toBe(exported?.id);
    }
  });

  it("an imported function merged with a type of the same name still resolves its calls", async () => {
    const { tables, analysis } = await analyze({
      "src/a.ts": [
        "export type run = number;",
        "export function run(): number { return 1; }",
        "export function ov(a: string): string;",
        "export function ov(a: number): number;",
        "export function ov(a: any): any { return a; }",
        "export function Both(): number { return 1; }",
        "export namespace Both { export const x = 1; }",
      ].join("\n"),
      "src/b.ts": 'import { run, ov, Both } from "./a";\nexport function main() { run(); ov(1); Both(); }\n',
    });

    const exports = (name: string) => ofKind(tables[0]!, "export", name);
    for (const name of ["run", "ov", "Both"]) {
      expect(exports(name)).toHaveLength(1);
      const call = analysis.calls.find((candidate) => candidate.callerName === "main" && candidate.calleeName === name);
      expect(call?.resolutionState).toBe("RESOLVED");
      expect(call?.targetSymbolId).toBe(exports(name)[0]?.id);
    }
  });

  it("calls inside a namespace resolve in the namespace's scope, not the module's", async () => {
    const { tables, analysis } = await analyze({
      "src/ns.ts": [
        "function f() { return 'module'; }",
        "export namespace NS {",
        "  export function f() { return 'ns'; }",
        "  export function g() { return f(); }",
        "}",
        "export function h() { return f(); }",
      ].join("\n"),
    });

    const functions = ofKind(tables[0]!, "function", "f");
    const moduleF = functions.find((symbol) => symbol.scopeId === "scope:module");
    const namespaceF = functions.find((symbol) => symbol.containerName === "NS");
    expect(moduleF).toBeDefined();
    expect(namespaceF).toBeDefined();

    const inNamespace = analysis.calls.find((call) => call.callerName === "g" && call.calleeName === "f");
    expect(inNamespace?.resolutionState).toBe("RESOLVED");
    expect(inNamespace?.targetSymbolId).toBe(namespaceF?.id);
    const inModule = analysis.calls.find((call) => call.callerName === "h" && call.calleeName === "f");
    expect(inModule?.resolutionState).toBe("RESOLVED");
    expect(inModule?.targetSymbolId).toBe(moduleF?.id);
  });

  it("import x = require() is a binding like const x = require(): used it is referenced, unused it is an unused import", async () => {
    const { analysis } = await analyze({
      "src/legacy.ts": [
        "import used = require('fs');",
        "import unused = require('node:path');",
        "export function read() { return used.readFileSync('x'); }",
      ].join("\n"),
      "src/modern.ts": [
        "const used = require('fs');",
        "const unused = require('node:path');",
        "export function read() { return used.readFileSync('x'); }",
      ].join("\n"),
    });

    const unusedIn = (file: string) => analysis.unusedImports.filter((finding) => finding.filePath === file).map((finding) => finding.name);
    expect(unusedIn("src/modern.ts")).toEqual(["unused"]);
    expect(unusedIn("src/legacy.ts")).toEqual(["unused"]);
  });

  it("references inside a namespace resolve to its let, const, var, function and class bindings", async () => {
    const { analysis } = await analyze({
      "src/ns.ts": [
        "export namespace NS {",
        "  var v = 1;",
        "  const k = 2;",
        "  class Helper {}",
        "  function helper() { return v + k + new Helper().constructor.length; }",
        "  export function g() { return helper(); }",
        "}",
      ].join("\n"),
    });

    const dead = analysis.deadCode.map((finding) => finding.name);
    for (const name of ["v", "k", "Helper", "helper", "g"]) expect(dead).not.toContain(name);
    const referenced = analysis.references.filter((reference) => reference.kind === "identifier" && reference.resolutionState === "RESOLVED").map((reference) => reference.name);
    for (const name of ["v", "k", "Helper", "helper"]) expect(referenced).toContain(name);
  });

  it("a declare function is a binding: a type query on it is a reference, so it is not dead code", async () => {
    const { analysis } = await analyze({
      "src/ambient.ts": [
        "declare function create<T>(values: T[]): T;",
        "declare function create<T>(values: T[], extra: number): T;",
        "declare function unused(): void;",
        "export declare const make: typeof create;",
      ].join("\n"),
    });

    const dead = analysis.deadCode.map((finding) => finding.name);
    expect(dead).not.toContain("create");
    expect(dead).toContain("unused");
  });

  it("an enum is a runtime binding that shadows an outer function; an interface or type alias is not", async () => {
    const { tables, analysis } = await analyze({
      "src/shadow.ts": [
        "function helper() { return 1; }",
        "export function shadowedByEnum() { enum helper { A } return helper(); }",
        "export function notShadowedByInterface() { interface helper { a: 1 } type helper2 = number; return helper(); }",
      ].join("\n"),
    });

    const moduleHelper = ofKind(tables[0]!, "function", "helper").find((symbol) => symbol.scopeId === "scope:module");
    const shadowed = analysis.calls.find((call) => call.callerName === "shadowedByEnum" && call.calleeName === "helper");
    expect(shadowed?.resolutionState).toBe("UNRESOLVED");
    const typeOnly = analysis.calls.find((call) => call.callerName === "notShadowedByInterface" && call.calleeName === "helper");
    expect(typeOnly?.resolutionState).toBe("RESOLVED");
    expect(typeOnly?.targetSymbolId).toBe(moduleHelper?.id);
  });

  it("an import A = NS.B alias is a binding: used it is not dead code, unused it is", async () => {
    const { analysis } = await analyze({
      "src/alias.ts": [
        "namespace NS { export const B = { m() { return 1; } }; }",
        "import Used = NS.B;",
        "import Unused = NS.B;",
        "export function run() { return Used.m(); }",
      ].join("\n"),
    });

    const dead = analysis.deadCode.map((finding) => finding.name);
    expect(dead).toContain("Unused");
    expect(dead).not.toContain("Used");
  });

  it("type-only declarations are not runtime bindings and do not count as dead code", async () => {
    const { analysis } = await analyze({
      "src/types.ts": "enum E { A }\nnamespace N { export const v = 1; }\ninterface I { a: 1 }\ntype T = number;\ndeclare function d(): void;\nexport const keep = 1;\n",
    });

    const dead = analysis.deadCode.map((finding) => finding.name);
    for (const name of ["E", "N", "I", "T"]) expect(dead).not.toContain(name);
  });
});
