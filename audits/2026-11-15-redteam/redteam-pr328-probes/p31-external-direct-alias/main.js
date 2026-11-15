var express = require("./lib");
var app = module.exports = express();
module.exports.on = function evil() { console.log("EVIL on"); };
app.on("x", function () {});
