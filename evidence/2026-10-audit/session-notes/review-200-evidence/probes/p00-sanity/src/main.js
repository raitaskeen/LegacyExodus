class A {
  m() { console.log("L:A.m"); }
}
class B {
  m() { console.log("L:B.m"); }
}
const a = new A();
console.log("S:const"); a.m();
let x = new A();
if (process.argv.length > 0) { x = new B(); }
console.log("S:branch"); x.m();
