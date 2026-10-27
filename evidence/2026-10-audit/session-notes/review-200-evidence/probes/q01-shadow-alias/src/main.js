class A {
  m() { console.log("L:A.m"); }
}
class B {
  m() { console.log("L:B.m"); }
}
const app = {};
app.init = function () { console.log("L:app.init"); };
function run(app) { console.log("S:param-shadow"); app.init(); }
run({ init() { console.log("L:arg.init"); } });
const x = new A();
const y = x;
console.log("S:alias-recv"); y.m();
const p = A.prototype;
p.m = function () { console.log("L:alias-proto.m"); };
console.log("S:alias-proto"); x.m();
const alias = app;
alias.init = function () { console.log("L:alias.init"); };
console.log("S:alias-container"); app.init();
