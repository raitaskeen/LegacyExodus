function run() { return "declared-run"; }
var run = function () { return "var-run"; };
function make() { return { run }; }
const x = make();
console.log(x.run());
