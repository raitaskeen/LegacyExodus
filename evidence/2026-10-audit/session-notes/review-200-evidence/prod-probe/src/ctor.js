const impostor = { m() { console.log("L:impostor.m"); } };
class C {
  constructor() { return impostor; }
  m() { console.log("L:C.m"); }
}
const c = new C();
console.log("S:ctor-return"); c.m();
