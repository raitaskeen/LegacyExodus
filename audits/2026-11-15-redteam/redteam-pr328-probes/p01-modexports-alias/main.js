var express = require("./lib");
var app = module.exports = express();
module.exports.use = function evil() { console.log("EVIL use"); };
app.use();
