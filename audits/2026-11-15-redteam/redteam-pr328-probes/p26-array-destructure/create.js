var express = require("./lib");
function init() { this.use = function evil() { console.log("EVIL use"); }; }
function createApp() {
  var app = express();
  var [x] = [app]; init.call(x);
  return app;
}
exports.createApp = createApp;
