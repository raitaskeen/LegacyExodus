function make() { return function () { console.log("L:field-fn"); }; }
class C {
  m = make();
  m() { console.log("L:C.m"); }
}
const c = new C();
console.log("S:own-field"); c.m();
