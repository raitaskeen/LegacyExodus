export const cases = [
  { name: "control: new exported class", callee: "c.m", entry: "main.js", esm: true, files: { "main.js": `export class C { m() { __seen.push("C.m"); } }\nconst c = new C();\nc.m();` } },
  { name: "control: exported fn call", callee: "f", entry: "main.js", esm: true, files: { "main.js": `export function f() { __seen.push("f"); }\nf();` } },
];
