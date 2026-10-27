const lib = require("./lib");
if (process.argv.length > 0) lib.run = function () { console.log("L:patched.run"); };
console.log("S:lib.run"); lib.run();
