var express = require("./lib");
function createApp() { var app = express(); return app; }
createApp = function fake() { return { use: function evil() { console.log("EVIL use"); } }; };
module.exports = createApp;
