var express = require("./lib");
function createApp() {
  var app = express();
  eval("app.use = function evil() { console.log('EVIL use') }");
  return app;
}
exports.createApp = createApp;
