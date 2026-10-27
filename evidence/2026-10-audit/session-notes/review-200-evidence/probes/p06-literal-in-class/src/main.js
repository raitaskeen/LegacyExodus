class C {
  make() { return { toString() { console.log("L:literal.toString"); return "lit"; } }; }
}
const c = new C();
console.log("S:inst-toString"); console.log("L:Object.prototype.toString?", c.toString());
