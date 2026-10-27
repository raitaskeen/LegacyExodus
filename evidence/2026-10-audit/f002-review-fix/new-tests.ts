
// Counterexamples from the independent red-team review of efe425a. Each program was executed
// and a different function ran than the one the call graph claimed.
describe("F-002 call resolution soundness: independent review counterexamples", () => {
  async function analyzeFiles(files: Readonly<Record<string, string>>) {
    const artifacts = Object.entries(files).map(([path, source]) => ({ id: path, path, language: path.endsWith(".ts") ? "typescript" : "javascript", size: source.length }));
    const asts = await Promise.all(artifacts.map(async (file) => (await parser.parse({ file, source: files[file.path]! })).result!));
    const tables = asts.map((ast) => extractor.extract(ast));
    const dependencyGraph = new DeterministicDependencyGraphBuilder().build(tables, artifacts);
    const analysis = new DeterministicSemanticAnalysisEngine().analyze({ astResults: asts, dependencyGraph, symbolTables: tables });
    return { analysis, symbols: tables.flatMap((table) => table.symbols) };
  }
  function markedLine(files: Readonly<Record<string, string>>, file: string, marker: string): number {
    const line = files[file]!.split("\n").findIndex((text) => text.includes(marker)) + 1;
    expect(line).toBeGreaterThan(0);
    return line;
  }
  // Every call recorded on the marked line must stay unproven.
  async function unproven(files: Readonly<Record<string, string>>, file: string, marker: string) {
    const line = markedLine(files, file, marker);
    const { analysis } = await analyzeFiles(files);
    const calls = analysis.calls.filter((call) => call.sourceFilePath === file && call.location?.line === line);
    expect(calls.filter((call) => call.resolutionState === "RESOLVED").map((call) => call.calleeName)).toEqual([]);
  }
  async function resolvedOn(files: Readonly<Record<string, string>>, file: string, marker: string, calleeName: string) {
    const line = markedLine(files, file, marker);
    const { analysis, symbols } = await analyzeFiles(files);
    const calls = analysis.calls.filter((call) => call.sourceFilePath === file && call.location?.line === line && call.calleeName === calleeName);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.resolutionState).toBe("RESOLVED");
    return symbols.find((symbol) => symbol.id === calls[0]!.targetSymbolId)!;
  }
  const js = (source: string) => ({ "src/main.js": source });
  const ts = (source: string) => ({ "src/main.ts": source });

  describe("new C() does not always produce a C instance", () => {
    it("a constructor that returns another object", async () => {
      await unproven(js(`
        const impostor = { m() { return "impostor"; } };
        class C { constructor() { return impostor; } m() { return "C"; } }
        const c = new C();
        c.m(); // CALL
      `), "src/main.js", "// CALL");
    });

    it("a base-class constructor that returns another object", async () => {
      await unproven(js(`
        const impostor = { m() { return "impostor"; } };
        class Base { constructor() { return impostor; } }
        class C extends Base { m() { return "C"; } }
        const c = new C();
        c.m(); // CALL
      `), "src/main.js", "// CALL");
    });

    it("a superclass the file does not declare", async () => {
      await unproven(js(`
        import { Base } from "./base";
        class C extends Base { m() { return "C"; } }
        const c = new C();
        c.m(); // CALL
      `), "src/main.js", "// CALL");
    });

    it("control: a derived class whose local base neither returns nor defines the method", async () => {
      const target = await resolvedOn(js(`
        class Base { constructor() { this.ready = true; } }
        class C extends Base { constructor() { super(); return; } m() { return "C"; } }
        const c = new C();
        c.m(); // CALL
      `), "src/main.js", "// CALL", "c.m");
      expect(target).toMatchObject({ kind: "method", name: "m", containerName: "C" });
    });
  });

  describe("instance fields shadow prototype methods", () => {
    it("an own field with the method name", async () => {
      await unproven(js(`
        function make() { return function () { return "field"; }; }
        class C { m = make(); m() { return "C"; } }
        const c = new C();
        c.m(); // CALL
      `), "src/main.js", "// CALL");
    });

    it("a base-class field with the method name", async () => {
      await unproven(js(`
        class Base { m = () => "base field"; }
        class C extends Base { m() { return "C"; } }
        const c = new C();
        c.m(); // CALL
      `), "src/main.js", "// CALL");
    });
  });

  describe("call and apply are ordinary properties", () => {
    it("a function whose own call property was replaced", async () => {
      await unproven(js(`
        function f() { return "f"; }
        f.call = function () { return "own call"; };
        f.call(null); // CALL
      `), "src/main.js", "// CALL");
    });

    it("a method whose apply property was replaced", async () => {
      await unproven(js(`
        class A { m() { return "A"; } }
        const a = new A();
        A.prototype.m.apply = function () { return "own apply"; };
        a.m.apply(a, []); // CALL
      `), "src/main.js", "// CALL");
    });

    it("control: call on a function whose call property is never written", async () => {
      const target = await resolvedOn(js(`
        function f() { return "f"; }
        f.call(null); // CALL
      `), "src/main.js", "// CALL", "f");
      expect(target).toMatchObject({ kind: "function", name: "f" });
    });
  });

  describe("only members declared in the class body are its methods", () => {
    it("an object literal method inside a class method", async () => {
      await unproven(js(`
        class C { make() { return { toString() { return "literal"; } }; } }
        const c = new C();
        c.toString(); // CALL
      `), "src/main.js", "// CALL");
    });

    it("an object literal method inside a derived class method", async () => {
      await unproven(js(`
        class Base { only() { return "Base"; } }
        class C extends Base { make() { return { only() { return "literal"; } }; } }
        const c = new C();
        c.only(); // CALL
      `), "src/main.js", "// CALL");
    });

    it("a method of a class expression inside a class method", async () => {
      await unproven(js(`
        class Base { only() { return "Base"; } }
        class Outer extends Base { make() { return class { only() { return "expr"; } }; } }
        const o = new Outer();
        o.only(); // CALL
      `), "src/main.js", "// CALL");
    });

    it("an instance method called on the class", async () => {
      await unproven(js(`
        class B { static m() { return "static"; } }
        class C extends B { m() { return "instance"; } }
        C.m(); // CALL
      `), "src/main.js", "// CALL");
    });

    it("a getter called as a method", async () => {
      await unproven(js(`
        class C { get m() { return () => "returned"; } }
        const c = new C();
        c.m(); // CALL
      `), "src/main.js", "// CALL");
    });

    it("control: a private method of an unnamed class expression", async () => {
      const target = await resolvedOn(js(`
        const K = class { #m() { return 1; } go() { return this.#m(); } }; // CALL
      `), "src/main.js", "// CALL", "this.#m");
      expect(target).toMatchObject({ kind: "method", name: "#m" });
    });
  });

  describe("scopes the symbol table does not model", () => {
    it("a lexical declaration in a switch case shadowing an outer receiver", async () => {
      await unproven(js(`
        class A { m() { return "A"; } }
        class B { m() { return "B"; } }
        const x = new A();
        function test(k) {
          switch (k) { case 0: const x = new B(); x.m(); }
          x.m(); // CALL
        }
        test(1);
      `), "src/main.js", "// CALL");
    });

    it("a write past a switch-case declaration to the outer function", async () => {
      await unproven(js(`
        function f() { return "declared"; }
        function test(k) {
          switch (k) { case 0: let f = 1; }
          f = function () { return "rewritten"; };
        }
        test(1);
        f(); // CALL
      `), "src/main.js", "// CALL");
    });

    it("a declaration in a class static block", async () => {
      await unproven(js(`
        class A { m() { return "A"; } }
        class B { m() { return "B"; } }
        globalThis.x = new A();
        class K { static { const x = new B(); } }
        x.m(); // CALL
      `), "src/main.js", "// CALL");
    });

    it("a parameter default that closes over a name the body redeclares with var", async () => {
      await unproven(js(`
        class A { m() { return "A"; } }
        class B { m() { return "B"; } }
        var x = new A();
        function f(g = () => x.m()) { // CALL
          var x = new B();
          return g();
        }
        f();
      `), "src/main.js", "// CALL");
    });

    it("a named function expression calling its own name", async () => {
      await unproven(js(`
        function f() { return "outer"; }
        const g = function f(n) {
          if (n > 0) return f(0); // CALL
          return "inner";
        };
        g(1);
      `), "src/main.js", "// CALL");
    });

    it("a named class expression constructing its own name", async () => {
      await unproven(js(`
        class C { constructor() { this.v = "outer"; } }
        const K = class C {
          static make() { return new C(); } // CALL
        };
        K.make();
      `), "src/main.js", "// CALL");
    });

    it("a private method of a class expression named like a class declaration", async () => {
      await unproven(js(`
        class Inner { #m() { return "declaration"; } }
        const K = class Inner {
          #m() { return "expression"; }
          go() { return this.#m(); } // CALL
        };
        new K().go();
      `), "src/main.js", "// CALL");
    });

    it("control: a receiver declared outside a switch", async () => {
      const target = await resolvedOn(js(`
        class A { m() { return "A"; } }
        function test(k) {
          const x = new A();
          switch (k) { case 0: x.m(); } // CALL
        }
      `), "src/main.js", "// CALL", "x.m");
      expect(target).toMatchObject({ kind: "method", name: "m", containerName: "A" });
    });
  });

  describe("module imports are only visible where they are declared", () => {
    it("a require inside a function does not name a module-level call", async () => {
      await unproven({
        "src/helper.js": `module.exports = function helper() { return "helper"; };\n`,
        "src/main.js": `
          function h() { return "local"; }
          function lazy() { const h = require("./helper"); return h; }
          h(); // CALL
        `,
      }, "src/main.js", "// CALL");
    });
  });

  describe("constant keys respect hoisting", () => {
    it("a computed key whose constant is shadowed by a hoisted var", async () => {
      await unproven(js(`
        class A { m() { return "m"; } undefined() { return "undefined"; } }
        const x = new A();
        const k = "m";
        function run() { x[k](); var k = "zzz"; } // CALL
        run();
      `), "src/main.js", "// CALL");
    });
  });

  describe("TypeScript write targets", () => {
    it("an assignment through an as-expression", async () => {
      await unproven(ts(`
        class A { m() { return "A"; } }
        class B { m() { return "B"; } }
        let x: any = new A();
        function swap() { (x as any) = new B(); }
        swap();
        x.m(); // CALL
      `), "src/main.ts", "// CALL");
    });

    it("an assignment through a non-null assertion", async () => {
      await unproven(ts(`
        class A { m() { return "A"; } }
        class B { m() { return "B"; } }
        let y: any = new A();
        function swap() { y! = new B(); }
        swap();
        y.m(); // CALL
      `), "src/main.ts", "// CALL");
    });

    it("a constructor parameter property", async () => {
      await unproven(ts(`
        class A { m() { return "A"; } }
        class B { m() { return "B"; } }
        class C {
          constructor(private svc: any) {
            svc.m(); // CALL
            svc = new A();
          }
        }
        new C(new B());
      `), "src/main.ts", "// CALL");
    });
  });

  describe("decorators", () => {
    it("a decorated method may be replaced", async () => {
      await unproven(ts(`
        const replacement = function () { return "decorated"; };
        function replace(...args: any[]): any { return args.length === 3 ? { ...args[2], value: replacement } : replacement; }
        class C { @replace m() { return "C"; } }
        const c = new C();
        c.m(); // CALL
      `), "src/main.ts", "// CALL");
    });

    it("a decorated class may be replaced", async () => {
      await unproven(ts(`
        function swap(target: any): any { return class { m() { return "replacement"; } }; }
        @swap class C { m() { return "C"; } }
        const c = new C();
        c.m(); // CALL
      `), "src/main.ts", "// CALL");
    });
  });

  describe("logical assignment defines only when the property is missing", () => {
    it("??= on an object that already has the method", async () => {
      await unproven(js(`
        function make() { return { init() { return "make"; } }; }
        const app = make();
        app.init ??= function () { return "nullish"; };
        app.init(); // CALL
      `), "src/main.js", "// CALL");
    });

    it("||= on an object that already has the method", async () => {
      await unproven(js(`
        function make() { return { init() { return "make"; } }; }
        const svc = make();
        svc.init ||= function () { return "or"; };
        svc.init(); // CALL
      `), "src/main.js", "// CALL");
    });

    it("control: ??= on a fresh object without the method", async () => {
      const target = await resolvedOn(js(`
        const app = {};
        app.init ??= function () { return "nullish"; };
        app.init(); // CALL
      `), "src/main.js", "// CALL", "app.init");
      expect(target).toMatchObject({ name: "init" });
    });
  });
});
