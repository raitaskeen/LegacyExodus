class X {
  m() { console.log("L:X.m"); }
}
class C {
  m() { console.log("L:C.m"); }
}
class K {
  m() { console.log("L:K.m"); }
}
const k = new K();
Object.setPrototypeOf(k, X.prototype);
console.log("S:setproto"); k.m();
function F() {}
F.prototype.m = function () { console.log("L:F.m"); };
const f = new F();
console.log("S:fn-ctor"); f.m();
