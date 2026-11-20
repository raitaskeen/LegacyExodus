var express = require("./lib");
function createApp() {
  var app = exports = express();
  exports.on = function evil() { console.log("EVIL on"); };
  return app;
}
module.exports.createApp = createApp;
