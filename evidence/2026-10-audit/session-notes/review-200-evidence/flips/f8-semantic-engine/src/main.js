class A {
  handle() { console.log("L:A.handle"); }
  invoke() { console.log("S:se-invoke"); return this.handle(); }
}
class B {
  handle() { console.log("L:B.handle"); }
}
A.prototype.invoke.call(new B());
