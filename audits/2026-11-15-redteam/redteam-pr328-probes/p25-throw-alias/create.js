var express = require("./lib");
function init() { this.use = function evil() { console.log("EVIL use"); }; }
function createApp() {
  var app = express();
  try { throw app; } catch (e) { init.call(e); }
  return app;
}
exports.createApp = createApp;
