const impostor = { m() { console.log("L:impostor.m"); } };
class Base {
  constructor() { return impostor; }
}
class C extends Base {
  m() { console.log("L:C.m"); }
}
const c = new C();
console.log("S:base-ctor-return"); c.m();
