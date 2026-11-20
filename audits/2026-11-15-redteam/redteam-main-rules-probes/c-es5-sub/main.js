class C { go() { return this.m(); } m() { return "C.m"; } }
function Sub() {}
Sub.prototype = new C();
Sub.prototype.m = function () { return "Sub.m"; };
console.log(new Sub().go());
