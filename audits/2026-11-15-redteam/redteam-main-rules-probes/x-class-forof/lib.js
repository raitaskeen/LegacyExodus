class C { go() { return this.m(); } m() { return "class-m"; } }
module.exports = new C();
