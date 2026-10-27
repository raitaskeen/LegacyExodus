export interface ProbeCase {
  readonly name: string;
  readonly files: Record<string, string>;
  readonly entry: string;
  readonly callee: string;
  readonly esm?: boolean;
}

const one = (name: string, callee: string, source: string): ProbeCase => ({ name, callee, entry: "main.js", files: { "main.js": source } });
const AB = `class A { m() { __seen.push("A.m"); } }\nclass B { m() { __seen.push("B.m"); } }\n`;

export const cases: ProbeCase[] = [
  // ---- method-property mutation the write index may not see
  one("proto computed-literal write", "c.m", `class C { m() { __seen.push("C.m"); } }
C.prototype["m"] = function () { __seen.push("patched"); };
const c = new C(); c.m();`),
  one("proto Object.assign", "c.m", `class C { m() { __seen.push("C.m"); } }
Object.assign(C.prototype, { m() { __seen.push("mixin.m"); } });
const c = new C(); c.m();`),
  one("proto defineProperty", "c.m", `class C { m() { __seen.push("C.m"); } }
Object.defineProperty(C.prototype, "m", { value() { __seen.push("defined"); } });
const c = new C(); c.m();`),
  one("class field shadows method", "c.m", `class C { m = () => { __seen.push("field"); }; m() { __seen.push("C.m"); } }
const c = new C(); c.m();`),
  one("ctor this[\"m\"] write", "c.m", `class C { constructor() { this["m"] = () => __seen.push("ctor"); } m() { __seen.push("C.m"); } }
const c = new C(); c.m();`),
  one("ctor returns other object", "c.m", `class C { constructor() { return { m() { __seen.push("returned.m"); } }; } m() { __seen.push("C.m"); } }
const c = new C(); c.m();`),
  one("control: plain new C", "c.m", `class C { m() { __seen.push("C.m"); } }
const c = new C(); c.m();`),
  // ---- class binding identity
  one("class binding reassigned", "c.m", `${AB}let K = A; class C { m() { __seen.push("C.m"); } }
C = B;
const c = new C(); c.m();`),
  one("class name shadowed by param", "c.m", `${AB}class C { m() { __seen.push("C.m"); } }
function make(C) { const c = new C(); c.m(); }
make(B);`),
  // ---- containers
  one("container shadowed by param", "app.m", `const app = { m() { __seen.push("app.m"); } };
function run(app) { app.m(); }
run({ m() { __seen.push("other.m"); } });`),
  one("container shadowed by local const", "app.m", `const app = { m() { __seen.push("app.m"); } };
function run() { const app = { m() { __seen.push("inner.m"); } }; app.m(); }
run();`),
  one("container spread overwrites", "obj.m", `const extra = { m() { __seen.push("extra.m"); } };
const obj = { m() { __seen.push("obj.m"); }, ...extra };
obj.m();`),
  one("container computed-literal write", "obj.m", `const obj = { m() { __seen.push("obj.m"); } };
obj["m"] = () => __seen.push("patched");
obj.m();`),
  one("container Object.assign", "obj.m", `const obj = { m() { __seen.push("obj.m"); } };
Object.assign(obj, { m() { __seen.push("assigned"); } });
obj.m();`),
  one("container getter", "obj.m", `const obj = { get m() { __seen.push("getter"); return () => __seen.push("returned"); } };
obj.m();`),
  one("control: container", "obj.m", `const obj = { m() { __seen.push("obj.m"); } };
obj.m();`),
  // ---- binding writes the walker may not see
  one("logical &&= write", "x.m", `${AB}let x = new A(); x &&= new B(); x.m();`),
  one("for-of non-decl left", "x.m", `${AB}let x = new A(); for (x of [new B()]) {} x.m();`),
  one("short-circuit write", "x.m", `${AB}let x = new A(); const c = Math.random() >= 0; c && (x = new B()); x.m();`),
  one("labeled break skips write", "x.m", `${AB}let x = new A(); const c = true; lbl: { if (c) break lbl; x = new B(); } x.m();`),
  one("direct eval write", "x.m", `${AB}let x = new A(); eval("x = new B()"); x.m();`),
  one("with statement", "x.m", `${AB}const x = new A(); const o = { x: new B() }; with (o) { x.m(); }`),
  one("sloppy arguments alias", "x.m", `${AB}function f(x) { x = new A(); arguments[0] = new B(); x.m(); } f(0);`),
  one("annex-B block function", "f", `function f() { __seen.push("outer"); }
if (true) { function f() { __seen.push("block"); } }
f();`),
  one("private field reassigned", "this.#m", `class C { #m = () => __seen.push("f1"); run() { this.#m = () => __seen.push("f2"); this.#m(); } }
new C().run();`),
  one("control: private method", "this.#m", `class C { #m() { __seen.push("C.#m"); } run() { this.#m(); } }
new C().run();`),
  // ---- modules
  {
    name: "ESM live binding reassigned", callee: "f", entry: "b.js", esm: true, files: {
      "a.js": `export let f = () => __seen.push("first");\nexport function swap() { f = () => __seen.push("second"); }`,
      "b.js": `import { f, swap } from "./a.js";\nswap();\nf();`,
    },
  },
  {
    name: "ESM function decl reassigned", callee: "f", entry: "b.js", esm: true, files: {
      "a.js": `export function f() { __seen.push("decl"); }\nexport function swap() { f = () => __seen.push("swapped"); }`,
      "b.js": `import { f, swap } from "./a.js";\nswap();\nf();`,
    },
  },
  {
    name: "ESM namespace live binding", callee: "ns.f", entry: "b.js", esm: true, files: {
      "a.js": `export function f() { __seen.push("decl"); }\nexport function swap() { f = () => __seen.push("swapped"); }`,
      "b.js": `import * as ns from "./a.js";\nns.swap();\nns.f();`,
    },
  },
  {
    name: "control: ESM import", callee: "f", entry: "b.js", esm: true, files: {
      "a.js": `export function f() { __seen.push("decl"); }`,
      "b.js": `import { f } from "./a.js";\nf();`,
    },
  },
];
