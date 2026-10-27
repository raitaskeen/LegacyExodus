class C {
  m() { console.log("L:C.m"); }
}
const opts = Object.assign({}, { m: 1 });
const c = new C();
console.log("S:fresh-assign"); c.m();
const k = "m";
console.log("S:computed-const"); c[k]();
console.log("S:computed-literal"); c["m"]();
