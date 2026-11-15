var express = require("./lib");
var app = exports = module.exports = express();
exports.use = function evil() { console.log("EVIL use"); };
app.use();
