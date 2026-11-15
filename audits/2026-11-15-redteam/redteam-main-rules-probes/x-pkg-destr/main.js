const path = require("path");
[path.join] = [function () { return "patched-join"; }];
console.log(path.join("a", "b"));
