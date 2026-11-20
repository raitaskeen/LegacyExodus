class C { go() { return this.m(); } m() { return "C.m"; } }
module.exports = new C();
