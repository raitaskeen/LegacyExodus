var express = require("./lib");
function fakeUse() { console.log("FAKE use"); }
function express() { var o = { use: fakeUse }; return o; }
function createApp() { var app = express(); return app; }
var a = createApp();
a.use();
var b = express();
b.use();
