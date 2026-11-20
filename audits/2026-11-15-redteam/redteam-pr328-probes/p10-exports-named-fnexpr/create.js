var express = require("./lib");
function fakeUse() { console.log("FAKE use"); }
function createApp() { var app = express(); return app; }
exports.createApp = function createApp() { var o = {}; o.use = fakeUse; return o; };
