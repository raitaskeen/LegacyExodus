const { run } = require("./lib");
function helper() { function run() { return "helper-inner-run"; } return run(); }
function make() { return { run }; }
const x = make();
console.log(x.run(), helper());
