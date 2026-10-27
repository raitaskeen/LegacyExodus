const make = `function make() { return { init() { __seen.push("orig.init"); } }; }\n`;
export const cases = [
  { name: "control: hoisted var in block", callee: "app.init", entry: "main.js", files: { "main.js": `function f() { if (true) { var app = {}; app.init = function () { __seen.push("app.init"); }; } app.init(); }\nf();` } },
  { name: "control: arrow param same fn", callee: "app.init", entry: "main.js", files: { "main.js": `const setup = (app) => { app.init = function () { __seen.push("app.init"); }; app.init(); };\nsetup({});` } },
  { name: "object literal container", callee: "api.ping", entry: "main.js", files: { "main.js": `const api = { ping() { __seen.push("api.ping"); } };\napi.ping();` } },
  { name: "order: call before definition", callee: "app.init", entry: "main.js", files: { "main.js": `${make}const app = make();\napp.init();\napp.init = function () { __seen.push("assigned"); };` } },
  { name: "order: param defined after call", callee: "app.init", entry: "main.js", files: { "main.js": `function setup(app) { app.init(); app.init = function () { __seen.push("assigned"); }; }\nsetup({ init() { __seen.push("orig.init"); } });` } },
];
