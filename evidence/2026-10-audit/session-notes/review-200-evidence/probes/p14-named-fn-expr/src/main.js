function f() { console.log("L:outer-f"); }
const g = function f(n) {
  if (n > 0) { console.log("S:inner-name"); f(0); return; }
  console.log("L:inner-f");
};
g(1);
