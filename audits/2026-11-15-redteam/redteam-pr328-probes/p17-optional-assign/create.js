var express = require("./lib");
function createApp() {
  var app = express();
  Object.assign?.(app, { use: function evil() { console.log("EVIL use"); } });
  return app;
}
exports.createApp = createApp;
