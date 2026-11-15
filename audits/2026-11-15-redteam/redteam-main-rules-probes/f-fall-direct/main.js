function make(flag) {
  if (flag) return { run() { return "run"; } };
}
const x = make(false);
try { console.log(x.run()); } catch (e) { console.log("THROWS", e.message); }
