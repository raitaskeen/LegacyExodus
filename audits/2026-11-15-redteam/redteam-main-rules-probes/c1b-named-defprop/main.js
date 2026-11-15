const lib = require("./lib");
function make() { return { add: lib.add }; }
const x = make();
console.log(x.add());
