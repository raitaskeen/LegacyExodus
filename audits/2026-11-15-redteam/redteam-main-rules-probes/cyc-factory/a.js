const b = require("./b");
function make() { const o = { run() { return "a-run"; } }; return o; }
module.exports = make;
console.log(b.go());
