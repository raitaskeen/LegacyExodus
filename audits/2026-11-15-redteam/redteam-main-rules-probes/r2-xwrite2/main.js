const { app } = require("./lib");
app.init = function () { return "patched-init"; };
console.log(app.start());
