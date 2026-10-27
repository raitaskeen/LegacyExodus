class Inner {
  #m() { console.log("L:decl.#m"); }
}
const K = class Inner {
  #m() { console.log("L:expr.#m"); }
  go() { console.log("S:private-expr"); this.#m(); }
};
new K().go();
