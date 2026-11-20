function make() { const o = { run() { return "run"; } }; return o; }
function main() {
  try { console.log(x.run()); } catch (e) { console.log("THROWS", e.message); }
  var x = make();
  console.log(x.run());
}
main();
