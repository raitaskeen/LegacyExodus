class C { go() { return this.m(); } m() { return "C.m"; } }
const child = { __proto__: new C(), m() { return "child.m"; } };
console.log(child.go());
