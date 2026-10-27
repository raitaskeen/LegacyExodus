export const cases = [
  { name: "member symbol fakes receiver frame", callee: "x.m", entry: "main.js", files: { "main.js": `class A { m() { __seen.push("A.m"); } }\nclass B { m() { __seen.push("B.m"); } }\nconst o = {};\nlet x;\nfunction swap() { x = new B(); }\nfunction run() { o.x = 1; x = new A(); swap(); x.m(); }\nrun();` } },
  { name: "member symbol fakes container frame", callee: "app.init", entry: "main.js", files: { "main.js": `let app = {};\napp.init = function () { __seen.push("first"); };\nconst o = {};\nfunction run() { o.app = 1; app.init(); }\napp = { init() { __seen.push("second"); } };\nrun();` } },
  { name: "object key fakes receiver frame", callee: "x.m", entry: "main.js", files: { "main.js": `class A { m() { __seen.push("A.m"); } }\nclass B { m() { __seen.push("B.m"); } }\nlet x;\nfunction swap() { x = new B(); }\nfunction run() { const o = { x: 1 }; x = new A(); swap(); x.m(); }\nrun();` } },
  { name: "class member fakes function frame", callee: "f", entry: "main.js", files: { "main.js": `function f() { __seen.push("outer f"); }\nfunction run(g) { class K { f() {} } f(); }\nrun();` } },
];
