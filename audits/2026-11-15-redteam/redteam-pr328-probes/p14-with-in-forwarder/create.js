var express = require("./lib");
function createApp() {
  var app = express();
  with (app) { use = function evil() { console.log("EVIL use"); }; }
  return app;
}
exports.createApp = createApp;
