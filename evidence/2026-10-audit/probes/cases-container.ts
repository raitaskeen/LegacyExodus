// Container-binding identity probes: the receiver at the call must be the binding the method was defined on.
const make = `function make() { return { init() { __seen.push("other.init"); } }; }\n`;
export const cases = [
  // Counterexamples: the call's receiver is a different binding with the same name.
  { name: "param shadows module container", callee: "app.init", entry: "main.js", files: { "main.js": `const app = {};\napp.init = function () { __seen.push("app.init"); };\nfunction run(app) { app.init(); }\nrun({ init: () => __seen.push("other.init") });` } },
  { name: "block const shadows container", callee: "app.init", entry: "main.js", files: { "main.js": `${make}const app = {};\napp.init = function () { __seen.push("app.init"); };\n{ const app = make(); app.init(); }` } },
  { name: "defined on block local, called on module", callee: "app.init", entry: "main.js", files: { "main.js": `${make}const app = make();\n{ const app = {}; app.init = function () { __seen.push("inner.init"); }; }\napp.init();` } },
  { name: "defined on param, called on module", callee: "app.init", entry: "main.js", files: { "main.js": `${make}function decorate(app) { app.init = function () { __seen.push("decorated"); }; }\nconst app = make();\napp.init();` } },
  { name: "fastify logger.child shape", callee: "logger.child", entry: "main.js", files: { "main.js": `function childOf(logger) { return logger.child(); }\nfunction create() { const logger = {}; logger.child = () => __seen.push("null.child"); return logger; }\nchildOf({ child: () => __seen.push("pino.child") });` } },
  { name: "param shadows class (static)", callee: "C.m", entry: "main.js", files: { "main.js": `class C { static m() { __seen.push("C.m"); } }\nfunction run(C) { C.m(); }\nrun({ m: () => __seen.push("other.m") });` } },
  { name: "catch param shadows container", callee: "app.init", entry: "main.js", files: { "main.js": `const app = {};\napp.init = function () { __seen.push("app.init"); };\ntry { throw { init: () => __seen.push("thrown.init") }; } catch (app) { app.init(); }` } },
  // Controls: same binding, must stay RESOLVED.
  { name: "control: module container", callee: "app.init", entry: "main.js", files: { "main.js": `const app = {};\napp.init = function () { __seen.push("app.init"); };\napp.init();` } },
  { name: "control: called in nested fn", callee: "app.init", entry: "main.js", files: { "main.js": `const app = {};\napp.init = function () { __seen.push("app.init"); };\nfunction run() { app.init(); }\nrun();` } },
  { name: "control: defined in fn on outer", callee: "app.init", entry: "main.js", files: { "main.js": `const app = {};\nfunction setup() { app.init = function () { __seen.push("app.init"); }; }\nsetup();\napp.init();` } },
  { name: "control: same block", callee: "app.init", entry: "main.js", files: { "main.js": `{ const app = {}; app.init = function () { __seen.push("app.init"); }; app.init(); }` } },
  { name: "control: class static", callee: "C.m", entry: "main.js", files: { "main.js": `class C { static m() { __seen.push("C.m"); } }\nfunction run() { C.m(); }\nrun();` } },
];
