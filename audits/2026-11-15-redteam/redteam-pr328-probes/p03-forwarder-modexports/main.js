var express = require("./lib");
function createApp() {
  var app = module.exports = express();
  module.exports.use = function evil() { console.log("EVIL use"); };
  return app;
}
var a = createApp();
a.use();
