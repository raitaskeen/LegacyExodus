const inst = require("./lib");
[inst.m] = [function () { return "patched-by-destructuring"; }];
console.log(inst.go());
