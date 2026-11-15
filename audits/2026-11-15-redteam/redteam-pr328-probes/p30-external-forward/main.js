var c = require("./create");
var a = c.createApp();
a.on("x", function () {});
var express = require("./lib");
var b = express();
b.on("x", function () {});
console.log("b.on is EventEmitter's:", b.on === require("events").EventEmitter.prototype.on);
