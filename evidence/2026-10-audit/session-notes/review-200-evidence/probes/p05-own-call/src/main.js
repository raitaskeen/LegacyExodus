function f() { console.log("L:f"); }
f.call = function () { console.log("L:own-call"); };
console.log("S:f.call"); f.call(null);
class A {
  m() { console.log("L:A.m"); }
}
const a = new A();
A.prototype.m.apply = function () { console.log("L:own-apply"); };
console.log("S:a.m.apply"); a.m.apply(a, []);
