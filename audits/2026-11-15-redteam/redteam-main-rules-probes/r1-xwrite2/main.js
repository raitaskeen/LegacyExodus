const { c, go } = require("./lib");
c.m = function () { return "patched-from-other-file"; };
console.log(go());
