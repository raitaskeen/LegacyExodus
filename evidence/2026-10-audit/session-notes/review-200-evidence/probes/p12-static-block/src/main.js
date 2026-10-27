class A {
  m() { console.log("L:A.m"); }
}
class B {
  m() { console.log("L:B.m"); }
}
globalThis.x = new A();
class K {
  static {
    const x = new B();
  }
}
console.log("S:global-x"); x.m();
