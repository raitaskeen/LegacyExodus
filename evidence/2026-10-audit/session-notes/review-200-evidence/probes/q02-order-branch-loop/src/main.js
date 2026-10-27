class A {
  m() { console.log("L:A.m"); }
}
class B {
  m() { console.log("L:B.m"); }
}
let x = new A();
console.log("S:before-rewrite"); x.m();
x = new B();
console.log("S:after-rewrite"); x.m();
let z = new A();
for (let i = 0; i < 2; i++) { console.log("S:loop"); z.m(); z = new B(); }
let w = new A();
function swap() { w = new B(); }
swap();
console.log("S:closure-first"); w.m();
let v = new A();
switch (process.argv.length) { case 0: break; default: v = new B(); }
console.log("S:switch-write"); v.m();
const app = { };
out: { if (process.argv.length > 0) break out; app.init = function () { console.log("L:app.init"); }; }
app.init = app.init || function () { console.log("L:fallback"); };
console.log("S:labeled"); app.init();
