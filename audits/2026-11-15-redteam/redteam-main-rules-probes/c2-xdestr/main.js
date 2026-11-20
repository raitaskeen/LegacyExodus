require("./patch");
function F2() {}
F2.prototype.m = function () { return "F2.m"; };
const inst = require("./lib");
console.log(inst.m());
