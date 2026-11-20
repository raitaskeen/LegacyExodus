module.exports = require("./main");
module.exports.use = function evil() { console.log("EVIL use"); };
