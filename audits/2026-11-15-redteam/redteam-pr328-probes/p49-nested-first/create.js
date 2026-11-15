var express = require("./lib");
function fakeUse() { console.log("FAKE use"); }
function unused() {
  function createApp() { var o = { use: fakeUse }; return o; }
  return createApp;
}
function createApp() { var app = express(); return app; }
module.exports = createApp;
