export const cases = [
  { name: "local fn reassigned in nested fn (arrow)", callee: "f", entry: "main.js", files: { "main.js": `function f() { __seen.push("decl"); }\nfunction swap() { f = () => __seen.push("swapped"); }\nswap(); f();` } },
  { name: "local fn reassigned in nested fn (number)", callee: "f", entry: "main.js", files: { "main.js": `function f() { __seen.push("decl"); }\nfunction swap() { f = 1; }\nf();` } },
  { name: "receiver reassigned in nested fn (new)", callee: "x.m", entry: "main.js", files: { "main.js": `class A { m() { __seen.push("A.m"); } }\nclass B { m() { __seen.push("B.m"); } }\nlet x = new A();\nfunction swap() { x = new B(); }\nswap(); x.m();` } },
];
