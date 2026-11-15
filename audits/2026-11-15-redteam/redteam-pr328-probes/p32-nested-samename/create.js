var express = require("./lib");
function fakeUse() { console.log("FAKE use"); }
function createApp() { var app = express(); return app; }
function unused() {
  function createApp() { var o = { use: fakeUse }; return o; }
  return createApp;
}
module.exports = createApp;
