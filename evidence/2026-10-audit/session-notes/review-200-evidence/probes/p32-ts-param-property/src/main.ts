class A {
  m() { console.log("L:A.m"); }
}
class B {
  m() { console.log("L:B.m"); }
}
class C {
  constructor(private svc: any) {
    console.log("S:param-property"); svc.m();
    svc = new A();
  }
}
new C(new B());
