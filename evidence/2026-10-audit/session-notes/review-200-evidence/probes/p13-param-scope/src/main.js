class A {
  m() { console.log("L:A.m"); }
}
class B {
  m() { console.log("L:B.m"); }
}
var x = new A();
function f(g = () => { console.log("S:param-closure"); x.m(); }) {
  var x = new B();
  g();
}
f();
