class C { m() { return "C.m"; } }
const c = new C();
exports.c = c;
exports.go = function () { return c.m(); };
