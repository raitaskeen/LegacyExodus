class Base {
  only() { console.log("L:Base.only"); }
}
class Outer extends Base {
  make() {
    return class {
      only() { console.log("L:expr.only"); }
    };
  }
}
const o = new Outer();
console.log("S:expr-attrib"); o.only();
