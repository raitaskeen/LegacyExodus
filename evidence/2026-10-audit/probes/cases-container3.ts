export const cases = [
  { name: "control: exported class static", callee: "C.m", entry: "main.js", esm: true, files: { "main.js": `export class C { static m() { __seen.push("C.m"); } }\nC.m();` } },
  { name: "control: default-exported class", callee: "C.m", entry: "main.js", esm: true, files: { "main.js": `export default class C { static m() { __seen.push("C.m"); } }\nC.m();` } },
  { name: "control: exported container", callee: "app.init", entry: "main.js", esm: true, files: { "main.js": `export const app = {};\napp.init = function () { __seen.push("app.init"); };\napp.init();` } },
];
