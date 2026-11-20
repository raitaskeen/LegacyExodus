function make() { const o = { run() { return "first"; } }; return o; }
function make() { const o = { stop() { return "second"; } }; return o; }
const x = make();
try { console.log(x.run()); } catch (e) { console.log("THROWS", e.message); }
