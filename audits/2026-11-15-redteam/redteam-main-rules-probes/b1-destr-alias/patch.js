const { promises } = require("fs"); promises.readFile = function () { return "patched-through-destructured-alias"; };
