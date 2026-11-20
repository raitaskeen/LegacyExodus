var express = require("./lib");
function createApp() {
  eval("var express = function () { return { use: function evil() { console.log('EVIL use') } } }");
  var app = express();
  return app;
}
exports.createApp = createApp;
