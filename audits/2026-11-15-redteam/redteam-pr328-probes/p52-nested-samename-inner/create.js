var express = require("./lib");
function unused() {
  function createApp() { function fakeUse() { console.log("FAKE use"); } var o = { use: fakeUse }; return o; }
  return createApp;
}
function createApp() { var app = express(); app.x = 1; return app; }
module.exports = createApp;
