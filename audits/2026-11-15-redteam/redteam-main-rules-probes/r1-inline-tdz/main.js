function make() { const o = { run() { return "run"; } }; return o; }
try { use(); } catch (e) { console.log("THROWS", e.message); }
const x = make();
function use() { return x.run(); }
