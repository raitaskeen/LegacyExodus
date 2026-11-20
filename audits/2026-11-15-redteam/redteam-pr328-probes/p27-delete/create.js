var express = require("./lib");
function init() { this.use = function evil() { console.log("EVIL use"); }; }
function createApp() {
  var app = express();
  delete app.use;
  return app;
}
exports.createApp = createApp;
