function make() { const o = { run() { return "literal-run"; } }; return o; }
const x = make();
delete x.run;
try { console.log(x.run()); } catch (e) { console.log("THROWS", e.message); }
