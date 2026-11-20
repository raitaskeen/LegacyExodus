var express = require("./lib");
function fakeUse() { console.log("FAKE use"); }
function createApp() { var app = express(); return app; }
function createApp() { return makeFake(); }
function makeFake() { var o = {}; o.use = fakeUse; return o; }
module.exports = createApp;
