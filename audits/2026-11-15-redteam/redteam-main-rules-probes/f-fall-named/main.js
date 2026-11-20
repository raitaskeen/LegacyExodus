function make(flag) {
  const o = { run() { return "run"; } };
  if (flag) return o;
}
const x = make(false);
try { console.log(x.run()); } catch (e) { console.log("THROWS", e.message); }
