module.exports = require("./lib");
var m = module;
m.exports = function fake() { var o = {}; o.x = 0; return { use: function evil() { console.log("EVIL use"); } }; };
