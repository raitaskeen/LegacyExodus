var express = require("./lib");
function fakeUse() { console.log("FAKE use"); }
{
  let express = function () { var o = { use: fakeUse }; return o; };
  function createApp() { var app = express(); return app; }
  var a = createApp();
  a.use();
}
