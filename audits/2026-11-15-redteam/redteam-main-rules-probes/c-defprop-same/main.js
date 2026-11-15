class C { go() { return this.m(); } m() { return "C.m"; } }
const c = new C();
Object.defineProperty(c, "m", { value: function () { return "defined.m"; } });
console.log(c.go());
