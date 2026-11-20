var express = require("./lib");
var app = module.exports = express();
var app = module.exports = { use: function evil() { console.log("EVIL use"); } };
app.use();
