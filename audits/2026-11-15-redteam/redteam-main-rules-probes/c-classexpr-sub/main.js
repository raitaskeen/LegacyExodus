class C { go() { return this.m(); } m() { return "C.m"; } }
const D = class extends C { m() { return "D.m"; } };
console.log(new D().go());
