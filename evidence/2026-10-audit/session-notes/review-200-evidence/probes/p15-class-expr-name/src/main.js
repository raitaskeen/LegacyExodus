class C { constructor() { console.log("L:outer-C"); } }
const K = class C {
  constructor() { console.log("L:inner-C"); }
  static make() { console.log("S:inner-class-name"); return new C(); }
};
K.make();
