// Call-before-definition probes for container methods (`app.init = f` defined once on a never-rebound binding).
const make = `function make() { return { init() { __seen.push("orig"); } }; }\n`;
const def = `function () { __seen.push("def"); }`;
export const cases = [
  // Counterexamples: the call can run while the object still has another init.
  { name: "x call before def (factory)", callee: "app.init", entry: "main.js", files: { "main.js": `${make}const app = make();\napp.init();\napp.init = ${def};` } },
  { name: "x param: call before def", callee: "app.init", entry: "main.js", files: { "main.js": `function setup(app) { app.init(); app.init = ${def}; }\nsetup({ init() { __seen.push("orig"); } });` } },
  { name: "x def only on one branch", callee: "app.init", entry: "main.js", files: { "main.js": `${make}const app = make();\nconst flag = false;\nif (flag) app.init = ${def};\napp.init();` } },
  { name: "x def in fn called later", callee: "app.init", entry: "main.js", files: { "main.js": `${make}const app = make();\nfunction setup() { app.init = ${def}; }\napp.init();\nsetup();` } },
  { name: "x nested call runs first", callee: "app.init", entry: "main.js", files: { "main.js": `${make}const app = make();\nfunction run() { app.init(); }\nrun();\napp.init = ${def};` } },
  { name: "x inherited Object.prototype", callee: "app.toString", entry: "main.js", files: { "main.js": `const app = {};\n__seen.push(app.toString());\napp.toString = ${def};` } },
  { name: "x literal __proto__", callee: "app.init", entry: "main.js", files: { "main.js": `const app = { __proto__: { init() { __seen.push("orig"); } } };\napp.init();\napp.init = ${def};` } },
  { name: "x literal spread", callee: "app.init", entry: "main.js", files: { "main.js": `const base = { init() { __seen.push("orig"); } };\nconst app = { ...base };\napp.init();\napp.init = ${def};` } },
  { name: "x class inherits static", callee: "C.m", entry: "main.js", files: { "main.js": `class B { static m() { __seen.push("orig"); } }\nclass C extends B {}\nC.m();\nC.m = ${def};` } },
  // Controls: provable either because the object cannot already have it (A) or the definition runs first (B).
  { name: "ok fresh literal, straight line", callee: "app.init", entry: "main.js", files: { "main.js": `const app = {};\napp.init = ${def};\napp.init();` } },
  { name: "ok fresh literal, nested call", callee: "app.init", entry: "main.js", files: { "main.js": `const app = {};\napp.init = ${def};\nfunction run() { app.init(); }\nrun();` } },
  { name: "ok fresh literal, def in fn", callee: "app.init", entry: "main.js", files: { "main.js": `const app = {};\nfunction setup() { app.init = ${def}; }\nsetup();\napp.init();` } },
  { name: "ok function container", callee: "app.init", entry: "main.js", files: { "main.js": `function app() {}\napp.init = ${def};\nfunction run() { app.init(); }\nrun();` } },
  { name: "ok factory, def first same fn", callee: "app.init", entry: "main.js", files: { "main.js": `${make}const app = make();\napp.init = ${def};\napp.init();` } },
  { name: "ok param, def first same fn", callee: "app.init", entry: "main.js", files: { "main.js": `function setup(app) { app.init = ${def}; app.init(); }\nsetup({ init() { __seen.push("orig"); } });` } },
];
