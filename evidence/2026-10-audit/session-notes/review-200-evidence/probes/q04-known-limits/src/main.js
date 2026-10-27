class B {
  static m() { console.log("L:B.static.m"); }
}
class C extends B {
  m() { console.log("L:C.inst.m"); }
}
console.log("S:static-vs-inst"); C.m();
class G {
  get m() { return () => console.log("L:getter-returned"); }
}
const g = new G();
console.log("S:getter"); g.m();
