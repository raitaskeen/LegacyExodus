var express = require("./lib");
function fakeUse() { console.log("FAKE use"); }
function createApp() { var app = express(); return app; }
function install(createApp) { exports.make = createApp; }
install(function () { var o = {}; o.use = fakeUse; return o; });
