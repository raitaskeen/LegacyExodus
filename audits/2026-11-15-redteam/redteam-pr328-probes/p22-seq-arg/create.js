var express = require("./lib");
function init() { this.use = function evil() { console.log("EVIL use"); }; }
function createApp() {
  var app = express();
  init.call((0, app));
  return app;
}
exports.createApp = createApp;
