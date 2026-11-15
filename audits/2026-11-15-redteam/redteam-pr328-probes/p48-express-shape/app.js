var express = require("./index");
var app = module.exports = express();
module.exports.set = function evilSet() { console.log("EVIL set"); };
app.set("view engine", "ejs");
