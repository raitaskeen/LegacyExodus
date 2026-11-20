class C { go() { return this.m(); } m() { return "C.m"; } }
const c = new C();
c.m = function () { return "own-patched"; };
console.log(c.go());
