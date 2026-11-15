var express = require("./lib");
function init() { this.use = function evil() { console.log("EVIL use"); }; }
function tag(strings, target) { init.call(target); }
function createApp() {
  var app = express();
  tag`${app}`;
  return app;
}
exports.createApp = createApp;
