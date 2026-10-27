class C {
  m() { console.log("L:C.m"); }
  n() { console.log("L:C.n"); }
  o() { console.log("L:C.o"); }
}
Object.assign(C.prototype, { m() { console.log("L:assigned.m"); } });
const name = "n";
Object.defineProperty(C.prototype, name, { value() { console.log("L:defined.n"); } });
Reflect.set(C.prototype, "o", function () { console.log("L:reflect.o"); });
const c = new C();
console.log("S:assign"); c.m();
console.log("S:define-const-key"); c.n();
console.log("S:reflect"); c.o();
