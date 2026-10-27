class A {
  m() { console.log("L:A.m"); }
  undefined() { console.log("L:A.undefined"); }
}
const x = new A();
const k = "m";
function run() { console.log("S:computed"); x[k](); var k = "zzz"; }
run();
