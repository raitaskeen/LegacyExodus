var express = require("./lib");
function init() { this.use = function evil() { console.log("EVIL use"); }; }
var app = express();
init.call(app);
app.use();
