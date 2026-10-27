class Base {
  only() { console.log("L:Base.only"); }
}
class C extends Base {
  make() { return { only() { console.log("L:literal.only"); } }; }
}
const c = new C();
console.log("S:inherited"); c.only();
