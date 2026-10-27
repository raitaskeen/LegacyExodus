class C {
  static s() { console.log("L:C.s"); }
  m() { console.log("L:C.m"); }
  #p() { console.log("L:C.#p"); }
  run() { console.log("S:private"); this.#p(); }
}
class D extends C {
  m() { console.log("L:D.m"); }
}
console.log("S:static"); C.s();
console.log("S:inherited-static"); D.s();
const d = new D();
console.log("S:own-derived"); d.m();
d.run();
class E extends C {}
const e = new E();
console.log("S:inherited-inst"); e.m();
