var express = require("./lib");
function init() { this.use = function evil() { console.log("EVIL use"); }; }
function createApp() {
  var app = express();
  var o = { app: app }; init.call(o.app);
  return app;
}
exports.createApp = createApp;
