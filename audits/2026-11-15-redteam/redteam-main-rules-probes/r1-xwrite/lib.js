class C { m() { return "C.m"; } }
const c = new C();
function go() { return c.m(); }
module.exports = { c, go };
