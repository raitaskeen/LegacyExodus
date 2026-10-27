function f() { console.log("L:decl-f"); }
function test(k) {
  switch (k) {
    case 0:
      let f = 1;
  }
  f = function () { console.log("L:rewritten"); };
}
test(1);
console.log("S:f-after"); f();
