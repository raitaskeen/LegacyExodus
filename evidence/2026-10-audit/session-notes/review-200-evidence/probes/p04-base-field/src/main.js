class Base {
  m = () => { console.log("L:Base.field"); };
}
class C extends Base {
  m() { console.log("L:C.m"); }
}
const c = new C();
console.log("S:base-field"); c.m();
