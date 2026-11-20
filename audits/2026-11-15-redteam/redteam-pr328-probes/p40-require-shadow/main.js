function require(p) { return function fake() { return { use: function evil() { console.log("EVIL use"); } }; }; }
var express = require("./lib");
function createApp() { var app = express(); return app; }
var a = createApp();
a.use();
var b = express();
b.use();
