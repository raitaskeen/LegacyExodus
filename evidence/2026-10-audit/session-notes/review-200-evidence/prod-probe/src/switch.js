class A {
  m() { console.log("L:A.m"); }
}
class B {
  m() { console.log("L:B.m"); }
}
const x = new A();
function test(k) {
  switch (k) {
    case 0:
      const x = new B();
      x.m();
  }
  console.log("S:after-switch"); x.m();
}
test(1);
