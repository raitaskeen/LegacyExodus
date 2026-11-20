function make() { const o = { run() { return "run"; } }; return o; }
if (process.argv.length > 99) { var x = make(); }
try { console.log(x.run()); } catch (e) { console.log("THROWS", e.message); }
