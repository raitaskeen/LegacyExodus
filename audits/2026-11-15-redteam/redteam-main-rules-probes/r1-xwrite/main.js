const lib = require("./lib");
lib.c.m = function () { return "patched-from-other-file"; };
console.log(lib.go());
