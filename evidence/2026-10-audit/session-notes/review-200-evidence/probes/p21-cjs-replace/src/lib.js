exports.run = function () { console.log("L:exports.run"); };
module.exports = { run() { console.log("L:replacement.run"); } };
