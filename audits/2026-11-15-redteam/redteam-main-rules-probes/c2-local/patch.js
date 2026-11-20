const inst = require("./lib");
for (inst.m of [function () { return "patched-by-for-of"; }]);
