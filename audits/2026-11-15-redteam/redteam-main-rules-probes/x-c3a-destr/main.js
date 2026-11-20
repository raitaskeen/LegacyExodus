const lib = require("./lib");
({ fake: lib.run } = { fake: function () { return "patched-by-destructuring"; } });
console.log(lib.run());
