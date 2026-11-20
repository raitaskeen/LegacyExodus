function load(require) {
  const fs = require("fs");
  return fs.readFileSync("x");
}
console.log(load(function () { return { readFileSync: function () { return "fake-readFileSync"; } }; }));
